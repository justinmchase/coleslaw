use crate::config::{self, declaration, declarations, mode_kind_name, segments};
use crate::error::Error;
use crate::parse::{parse_file, parse_source};
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};

pub fn check_source(source: &str, name: &str) -> Result<(), Error> {
    let module = parse_source(source, name)?;
    check_module(&module, name)
}

pub fn check_file(path: &Path) -> Result<(), Error> {
    let module = load_graph(path)?;
    let name = path.display().to_string();
    check_module(&module, &name)
}

fn load_graph(path: &Path) -> Result<Json, Error> {
    let mut visiting = Vec::new();
    load_module(path, &mut visiting)
}

fn load_module(path: &Path, visiting: &mut Vec<PathBuf>) -> Result<Json, Error> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if visiting.iter().any(|seen| seen == &canonical) {
        return Err(Error::new(format!("import cycle at {}", path.display())));
    }
    visiting.push(canonical);
    let module = parse_file(path)?;
    let imports = declarations(&module)
        .filter(|declaration| kind(declaration) == Some("import"))
        .cloned()
        .collect::<Vec<_>>();
    for import in &imports {
        let specifier = import.get("moduleUrl").and_then(Json::as_str).unwrap_or("");
        if specifier.ends_with(".ts") || specifier.ends_with(".tsx") {
            return Err(Error::new(located(
                import,
                format!("Host adapters must not be TypeScript modules ({specifier})"),
            )));
        }
        if specifier.contains(':') && !specifier.starts_with('.') {
            return Err(Error::new(located(
                import,
                format!(
                    "{path}: unsupported import specifier {specifier}",
                    path = path.display()
                ),
            )));
        }
        let target = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(specifier);
        if !target.exists() {
            return Err(Error::new(located(
                import,
                format!(
                    "{}: cannot resolve {} imported from {}",
                    path.display(),
                    specifier,
                    path.display()
                ),
            )));
        }
        let imported = load_module(&target, visiting)?;
        let exported = export_names(&imported);
        let names = import
            .get("names")
            .and_then(Json::as_array)
            .cloned()
            .unwrap_or_default();
        for name in &names {
            let Some(name) = name.as_str() else {
                continue;
            };
            if !exported.contains(name) {
                return Err(Error::new(located(
                    import,
                    format!("{}: {name} is not exported by {specifier}", path.display()),
                )));
            }
        }
    }
    visiting.pop();
    Ok(module)
}

fn check_module(module: &Json, name: &str) -> Result<(), Error> {
    for import in declarations(module).filter(|declaration| kind(declaration) == Some("import")) {
        let specifier = import.get("moduleUrl").and_then(Json::as_str).unwrap_or("");
        if specifier.ends_with(".ts") || specifier.ends_with(".tsx") {
            return Err(Error::new(located(
                import,
                format!("Host adapters must not be TypeScript modules ({specifier})"),
            )));
        }
    }
    let mut diagnostics = Vec::new();
    if kind(module) != Some("module") {
        diagnostics.push(format!("{name}: expected a module syntax tree"));
    }
    check_names(module, &mut diagnostics);
    check_shapes(module, &mut diagnostics);
    check_program(module, &mut diagnostics);
    check_modes(module, &mut diagnostics);
    check_domain(module, &mut diagnostics);
    if diagnostics.is_empty() {
        Ok(())
    } else {
        Err(Error::new(diagnostics.join("\n")))
    }
}

fn check_names(module: &Json, diagnostics: &mut Vec<String>) {
    let mut declared = BTreeSet::new();
    let mut imported = BTreeSet::new();
    for declaration in declarations(module) {
        match kind(declaration) {
            Some("import") => {
                for name in declaration
                    .get("names")
                    .and_then(Json::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Json::as_str)
                {
                    if !imported.insert(name.to_string()) || declared.contains(name) {
                        diagnostics.push(located(
                            declaration,
                            format!("{name} is declared more than once"),
                        ));
                    }
                }
            }
            Some("export") => {}
            Some(_) => {
                if let Some(name) = declaration.get("name").and_then(Json::as_str) {
                    if !declared.insert(name.to_string()) || imported.contains(name) {
                        diagnostics.push(located(
                            declaration,
                            format!("{name} is declared more than once"),
                        ));
                    }
                }
            }
            None => {}
        }
    }
    for declaration in declarations(module) {
        if kind(declaration) != Some("export") {
            continue;
        }
        let Some(name) = declaration.get("name").and_then(Json::as_str) else {
            continue;
        };
        if !declared.contains(name) && !imported.contains(name) {
            diagnostics.push(located(
                declaration,
                format!("export {name} does not name a declaration"),
            ));
        }
    }
}

fn check_shapes(module: &Json, diagnostics: &mut Vec<String>) {
    for declaration in declarations(module) {
        match kind(declaration) {
            Some("shape") => {
                if let Some(pattern) = declaration.get("pattern") {
                    if let Err(error) = config::expand_pattern(pattern, module) {
                        diagnostics.push(located(declaration, error.message));
                    }
                }
            }
            Some("config") | Some("mode") | Some("aggregate") | Some("manager")
            | Some("controller") => {
                walk_patterns(declaration, module, diagnostics);
            }
            _ => {}
        }
    }
}

fn walk_patterns(value: &Json, module: &Json, diagnostics: &mut Vec<String>) {
    if let Some(pattern) = value.get("pattern") {
        if let Err(error) = config::expand_pattern(pattern, module) {
            diagnostics.push(located(value, error.message));
        } else if let Err(error) = kith_runtime::host::parse_pattern(pattern) {
            diagnostics.push(located(value, error.to_string()));
        }
    }
    match value {
        Json::Array(items) => {
            for item in items {
                walk_patterns(item, module, diagnostics);
            }
        }
        Json::Object(object) => {
            for (key, child) in object {
                if key == "pattern" {
                    continue;
                }
                walk_patterns(child, module, diagnostics);
            }
        }
        _ => {}
    }
}

fn check_program(module: &Json, diagnostics: &mut Vec<String>) {
    let programs = declarations(module)
        .filter(|declaration| kind(declaration) == Some("program"))
        .collect::<Vec<_>>();
    if programs.len() > 1 {
        diagnostics.push("module declares more than one program".into());
    }
    for program in programs {
        let config_name = segments(program.get("config").unwrap_or(&Json::Null));
        match declaration(module, &config_name) {
            Some(config) if kind(config) == Some("config") => {}
            _ => diagnostics.push(located(
                program,
                format!("unknown config {}", config_name.join(".")),
            )),
        }
        let mut indexes = BTreeSet::new();
        for positional in program
            .get("positionals")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            let index = positional.get("index").and_then(Json::as_u64).unwrap_or(0);
            if !indexes.insert(index) {
                diagnostics.push(located(
                    positional,
                    format!("positional {index} is declared more than once"),
                ));
            }
        }
        if let Err(error) = duplicate_labels(program) {
            diagnostics.push(error);
        }
        for selection in program
            .get("selections")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            let mode_name = segments(selection.get("mode").unwrap_or(&Json::Null));
            let Some(mode) = declaration(module, &mode_name) else {
                diagnostics.push(located(
                    selection,
                    format!("unknown mode {}", mode_name.join(".")),
                ));
                continue;
            };
            if kind(mode) != Some("mode") {
                diagnostics.push(located(
                    selection,
                    format!("{} is not a mode", mode_name.join(".")),
                ));
                continue;
            }
            let parameters = array_len(mode, "parameters");
            let arguments = array_len(selection, "arguments");
            if parameters != arguments {
                diagnostics.push(located(
                    selection,
                    format!(
                        "mode {} expects {parameters} arguments but the selection supplies {arguments}",
                        mode_name.join(".")
                    ),
                ));
            }
        }
    }
}

fn duplicate_labels(program: &Json) -> Result<(), String> {
    let mut labels = BTreeSet::new();
    let selections = program.get("selections").and_then(Json::as_array);
    let Some(selections) = selections else {
        return Err("Program must map at least one mode label".into());
    };
    if selections.is_empty() {
        return Err("Program must map at least one mode label".into());
    }
    for selection in selections {
        let Some(label) = selection.get("label").and_then(Json::as_str) else {
            continue;
        };
        if !labels.insert(label.to_string()) {
            return Err(format!("Mode label {label:?} is declared more than once"));
        }
    }
    Ok(())
}

fn check_modes(module: &Json, diagnostics: &mut Vec<String>) {
    for mode in declarations(module).filter(|declaration| kind(declaration) == Some("mode")) {
        let mode_name = mode.get("name").and_then(Json::as_str).unwrap_or("mode");
        let mut parameters = BTreeSet::new();
        for parameter in mode
            .get("parameters")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            let Some(name) = parameter.get("name").and_then(Json::as_str) else {
                continue;
            };
            if !parameters.insert(name.to_string()) {
                diagnostics.push(located(
                    parameter,
                    format!("mode {mode_name} parameter {name} is declared more than once"),
                ));
            }
        }
        let kind_name = mode_kind_name(mode);
        if !is_builtin_kind(&kind_name)
            && declaration(module, std::slice::from_ref(&kind_name)).is_none()
        {
            let imported = import_names(module);
            if !imported.contains(&kind_name) {
                diagnostics.push(located(mode, format!("unknown mode kind {kind_name}")));
            }
        }
        if is_builtin_kind(&kind_name) && import_names(module).contains(&kind_name) {
            diagnostics.push(located(
                mode,
                format!("built-in mode kind {kind_name} cannot be shadowed"),
            ));
        }
        let entry = entry_section(&kind_name);
        let mut saw_entry = false;
        let mut binding_names = BTreeSet::new();
        let mut bindings = Vec::new();
        for section in mode
            .get("sections")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            let section_name = section.get("name").and_then(Json::as_str).unwrap_or("");
            if !section_allowed(&kind_name, section_name) {
                diagnostics.push(located(
                    section,
                    format!("{kind_name} mode cannot declare {section_name}"),
                ));
            }
            if Some(section_name) == entry {
                saw_entry = true;
            }
            for binding in section
                .get("bindings")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
            {
                let Some(name) = binding.get("name").and_then(Json::as_str) else {
                    continue;
                };
                if !binding_names.insert(name.to_string()) {
                    diagnostics.push(located(
                        binding,
                        format!("Duplicate component binding {name}"),
                    ));
                }
                bindings.push((section_name.to_string(), binding));
            }
        }
        let mut edges: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (section_name, binding) in &bindings {
            let Some(name) = binding.get("name").and_then(Json::as_str) else {
                continue;
            };
            let component = segments(binding.get("component").unwrap_or(&Json::Null));
            edges.insert(name.to_string(), reference_edges(binding, &binding_names));
            check_binding_target(
                module,
                &kind_name,
                section_name,
                name,
                &component,
                binding,
                diagnostics,
            );
        }
        if entry.is_some() && !saw_entry {
            diagnostics.push(located(
                mode,
                format!(
                    "{kind_name} mode requires {} entry points",
                    entry.unwrap_or("entry")
                ),
            ));
        }
        let mut visiting = HashSet::new();
        let mut visited = HashSet::new();
        for name in edges.keys() {
            visit_binding(name, &edges, &mut visiting, &mut visited, diagnostics);
        }
    }
}

fn reference_edges(binding: &Json, bindings: &BTreeSet<String>) -> Vec<String> {
    let mut names = Vec::new();
    collect_references(binding.get("arguments").unwrap_or(&Json::Null), &mut names);
    names
        .into_iter()
        .filter(|name| bindings.contains(name))
        .collect()
}

fn collect_references(value: &Json, names: &mut Vec<String>) {
    if kind(value) == Some("reference") {
        if let Some(name) = value.get("name").and_then(Json::as_str) {
            names.push(name.to_string());
        }
    }
    match value {
        Json::Array(items) => {
            for item in items {
                collect_references(item, names);
            }
        }
        Json::Object(object) => {
            if kind(value) == Some("invocation") {
                for (key, child) in object {
                    if key == "expression" {
                        continue;
                    }
                    collect_references(child, names);
                }
            } else {
                for child in object.values() {
                    collect_references(child, names);
                }
            }
        }
        _ => {}
    }
}

fn visit_binding(
    name: &str,
    edges: &BTreeMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
    diagnostics: &mut Vec<String>,
) {
    if visiting.contains(name) {
        diagnostics.push(format!("Dependency cycle includes {name}"));
        return;
    }
    if visited.contains(name) {
        return;
    }
    visiting.insert(name.to_string());
    for dependency in edges.get(name).into_iter().flatten() {
        visit_binding(dependency, edges, visiting, visited, diagnostics);
    }
    visiting.remove(name);
    visited.insert(name.to_string());
}

fn check_binding_target(
    module: &Json,
    mode_kind: &str,
    section: &str,
    binding: &str,
    component: &[String],
    node: &Json,
    diagnostics: &mut Vec<String>,
) {
    if component.len() == 2 {
        let context = declaration(module, &[component[0].clone()]);
        let Some(context) = context.filter(|declaration| kind(declaration) == Some("context"))
        else {
            diagnostics.push(located(node, format!("unknown context {}", component[0])));
            return;
        };
        let exported_context = export_names(module).contains(&component[0]);
        let member = context
            .get("members")
            .and_then(Json::as_array)
            .and_then(|members| {
                members.iter().find(|member| {
                    member.get("name").and_then(Json::as_str) == Some(component[1].as_str())
                })
            });
        let Some(member) = member else {
            diagnostics.push(located(
                node,
                format!("context {} has no binding {}", component[0], component[1]),
            ));
            return;
        };
        if !exported_context || member.get("exported").and_then(Json::as_bool) != Some(true) {
            diagnostics.push(located(
                node,
                format!(
                    "mode cannot reach {}.{} because it is not an exported controller binding",
                    component[0], component[1]
                ),
            ));
        }
        return;
    }
    if let Some(name) = component.first() {
        if let Some(target) = declaration(module, std::slice::from_ref(name)) {
            let target_kind = kind(target).unwrap_or("");
            if section == "controllers" && target_kind == "aggregate" {
                diagnostics.push(located(
                    node,
                    format!("controller binding {binding} must not take aggregate {name}"),
                ));
            }
            if section == "managers" && target_kind == "aggregate" {
                diagnostics.push(located(
                    node,
                    format!(
                        "managers section must not bind aggregate {name}; a manager sends to its aggregate port"
                    ),
                ));
            }
            if mode_kind == "Web" && target_kind == "aggregate" {
                diagnostics.push(located(
                    node,
                    "Web mode must not grant aggregate mutation through a composed binding",
                ));
            }
        }
    }
}

fn check_domain(module: &Json, diagnostics: &mut Vec<String>) {
    let mut contexts: BTreeMap<String, String> = BTreeMap::new();
    for context in declarations(module).filter(|declaration| kind(declaration) == Some("context")) {
        let context_name = context
            .get("name")
            .and_then(Json::as_str)
            .unwrap_or("context");
        let mut names = BTreeSet::new();
        let members = context
            .get("members")
            .and_then(Json::as_array)
            .cloned()
            .unwrap_or_default();
        for member in &members {
            let member_name = member.get("name").and_then(Json::as_str).unwrap_or("");
            if !names.insert(member_name.to_string()) {
                diagnostics.push(located(
                    member,
                    format!("Context binding {member_name} is declared more than once"),
                ));
            }
            let target_name = member
                .get("declaration")
                .and_then(Json::as_str)
                .unwrap_or("");
            let Some(target) = declaration(module, &[target_name.to_string()]) else {
                if import_names(module).contains(target_name) {
                    diagnostics.push(located(
                        member,
                        format!(
                            "Context {context_name} cannot bind imported declaration {target_name}; imported domain declarations are not supported as context bindings"
                        ),
                    ));
                } else {
                    diagnostics.push(located(
                        member,
                        format!(
                            "Context {context_name} binding {member_name} refers to unknown declaration {target_name}"
                        ),
                    ));
                }
                continue;
            };
            let target_kind = kind(target).unwrap_or("");
            if !matches!(target_kind, "aggregate" | "manager" | "controller") {
                diagnostics.push(located(
                    member,
                    format!(
                        "Context {context_name} binding {member_name} must compose an aggregate, manager, or controller"
                    ),
                ));
                continue;
            }
            if member.get("exported").and_then(Json::as_bool) == Some(true)
                && target_kind != "controller"
            {
                diagnostics.push(located(
                    member,
                    format!(
                        "Context {context_name} must not export {target_kind} binding {member_name}"
                    ),
                ));
            }
            if let Some(owner) = contexts.get(target_name) {
                if owner != context_name {
                    diagnostics.push(located(
                        member,
                        format!("{target_name} is owned by both {owner} and {context_name}"),
                    ));
                }
            } else {
                contexts.insert(target_name.to_string(), context_name.to_string());
            }
        }
        check_context_arguments(module, context_name, &members, diagnostics);
    }
    for declaration in declarations(module) {
        let Some(declaration_kind) = kind(declaration) else {
            continue;
        };
        if !matches!(declaration_kind, "aggregate" | "manager" | "controller") {
            continue;
        }
        let name = declaration.get("name").and_then(Json::as_str).unwrap_or("");
        if !contexts.contains_key(name) {
            diagnostics.push(located(
                declaration,
                format!("{declaration_kind} {name} must belong to a context"),
            ));
        }
    }
    for export in declarations(module).filter(|declaration| kind(declaration) == Some("export")) {
        let Some(name) = export.get("name").and_then(Json::as_str) else {
            continue;
        };
        if let Some(target) = declaration(module, &[name.to_string()]) {
            if matches!(kind(target), Some("aggregate" | "manager")) {
                diagnostics.push(located(
                    export,
                    format!(
                        "A context must not export {} {name}",
                        kind(target).unwrap_or("declaration")
                    ),
                ));
            }
        }
    }
    let aggregates = domain_map(module, "aggregate");
    let managers = domain_map(module, "manager");
    for aggregate in aggregates.values() {
        check_aggregate(aggregate, diagnostics);
    }
    for manager in managers.values() {
        check_manager(module, manager, &aggregates, &contexts, diagnostics);
    }
    for controller in
        declarations(module).filter(|declaration| kind(declaration) == Some("controller"))
    {
        check_controller(controller, &managers, &contexts, diagnostics);
    }
}

fn check_context_arguments(
    module: &Json,
    context_name: &str,
    members: &[Json],
    diagnostics: &mut Vec<String>,
) {
    let by_name = members
        .iter()
        .filter_map(|member| {
            member
                .get("name")
                .and_then(Json::as_str)
                .map(|name| (name.to_string(), member))
        })
        .collect::<BTreeMap<_, _>>();
    let mut edges: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for member in members {
        let member_name = member.get("name").and_then(Json::as_str).unwrap_or("");
        let target_name = member
            .get("declaration")
            .and_then(Json::as_str)
            .unwrap_or("");
        let Some(target) = declaration(module, &[target_name.to_string()]) else {
            continue;
        };
        let parameters = target
            .get("parameters")
            .and_then(Json::as_array)
            .cloned()
            .unwrap_or_default();
        let arguments = member
            .get("arguments")
            .and_then(Json::as_array)
            .cloned()
            .unwrap_or_default();
        if arguments.len() != parameters.len() {
            diagnostics.push(located(
                member,
                format!(
                    "Context binding {member_name} expects {} dependencies but received {}",
                    parameters.len(),
                    arguments.len()
                ),
            ));
        }
        let mut dependencies = Vec::new();
        for (parameter, argument) in parameters.iter().zip(arguments.iter()) {
            let argument_name = argument.as_str().unwrap_or("");
            let Some(dependency) = by_name.get(argument_name) else {
                diagnostics.push(located(
                    member,
                    format!(
                        "Context binding {member_name} refers to unknown binding {argument_name}"
                    ),
                ));
                continue;
            };
            dependencies.push(argument_name.to_string());
            let expected = parameter.get("type").and_then(Json::as_str).unwrap_or("");
            let actual = dependency
                .get("declaration")
                .and_then(Json::as_str)
                .unwrap_or("");
            if expected != actual {
                let parameter_name = parameter.get("name").and_then(Json::as_str).unwrap_or("");
                diagnostics.push(located(
                    member,
                    format!(
                        "Context binding {member_name}.{parameter_name} requires {expected}, not {actual}"
                    ),
                ));
            }
            let owner = declaration(module, &[actual.to_string()])
                .and_then(|declaration| declaration.get("name"))
                .and_then(Json::as_str);
            if owner.is_some()
                && contexts_of(module, actual).is_some_and(|owner| owner != context_name)
            {
                diagnostics.push(located(
                    member,
                    format!("Context {context_name} cannot compose {actual} outside its context"),
                ));
            }
        }
        edges.insert(member_name.to_string(), dependencies);
    }
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    for name in by_name.keys() {
        visit_context(
            name,
            context_name,
            &edges,
            &mut visiting,
            &mut visited,
            diagnostics,
        );
    }
}

fn visit_context(
    name: &str,
    context_name: &str,
    edges: &BTreeMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
    diagnostics: &mut Vec<String>,
) {
    if visiting.contains(name) {
        diagnostics.push(format!(
            "Context {context_name} has a dependency cycle at {name}"
        ));
        return;
    }
    if visited.contains(name) {
        return;
    }
    visiting.insert(name.to_string());
    for dependency in edges.get(name).into_iter().flatten() {
        visit_context(
            dependency,
            context_name,
            edges,
            visiting,
            visited,
            diagnostics,
        );
    }
    visiting.remove(name);
    visited.insert(name.to_string());
}

fn contexts_of(module: &Json, declaration_name: &str) -> Option<String> {
    for context in declarations(module).filter(|declaration| kind(declaration) == Some("context")) {
        let members = context.get("members").and_then(Json::as_array)?;
        if members.iter().any(|member| {
            member.get("declaration").and_then(Json::as_str) == Some(declaration_name)
        }) {
            return context
                .get("name")
                .and_then(Json::as_str)
                .map(str::to_string);
        }
    }
    None
}

fn check_aggregate(aggregate: &Json, diagnostics: &mut Vec<String>) {
    let name = aggregate
        .get("name")
        .and_then(Json::as_str)
        .unwrap_or("aggregate");
    let fields = aggregate
        .get("fields")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    duplicate(&fields, "name", &format!("field on {name}"), diagnostics);
    let field_names = fields
        .iter()
        .filter_map(|field| field.get("name").and_then(Json::as_str))
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    duplicate(
        aggregate
            .get("commands")
            .and_then(Json::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        "name",
        &format!("command on {name}"),
        diagnostics,
    );
    duplicate(
        aggregate
            .get("events")
            .and_then(Json::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        "name",
        &format!("event on {name}"),
        diagnostics,
    );
    let states = aggregate
        .get("states")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    duplicate(&states, "name", &format!("state on {name}"), diagnostics);
    let state_names = states
        .iter()
        .filter_map(|state| state.get("name").and_then(Json::as_str))
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    let commands = names_of(aggregate, "commands");
    let events = names_of(aggregate, "events");
    if aggregate
        .get("fields")
        .and_then(|fields| fields.get("kind"))
        .is_some()
    {
        diagnostics.push(located(
            aggregate,
            format!("{name} must declare each field once, not as a nested field group"),
        ));
    }
    for state in &states {
        if state.get("fields").is_some() || state.get("field").is_some() {
            diagnostics.push(located(
                state,
                format!("state on {name} must not declare a field; a field is declared once"),
            ));
        }
        let state_name = state.get("name").and_then(Json::as_str).unwrap_or("");
        for handler in state
            .get("handlers")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(command) = handler.get("command").and_then(Json::as_str) {
                if !commands.contains(command) {
                    diagnostics.push(located(
                        handler,
                        format!("{name}.{state_name} handles unknown command {command}"),
                    ));
                }
                if handler.get("set").is_some() {
                    diagnostics.push(located(
                        handler,
                        format!("command {command} on {name} must not assign fields"),
                    ));
                }
                if let Some(decision) = handler.get("decision") {
                    if decision.get("kind").and_then(Json::as_str) == Some("emit") {
                        for event in decision
                            .get("events")
                            .and_then(Json::as_array)
                            .into_iter()
                            .flatten()
                        {
                            let event_name = event.get("name").and_then(Json::as_str).unwrap_or("");
                            if !events.contains(event_name) {
                                diagnostics.push(located(
                                    event,
                                    format!("{name} emits unknown event {event_name}"),
                                ));
                            }
                            expect_scope(
                                event.get("payload").unwrap_or(&Json::Null),
                                &["input", "state"],
                                diagnostics,
                                &format!("{name} emit {event_name}"),
                            );
                        }
                    } else if let Some(reason) = decision.get("reason") {
                        expect_scope(
                            reason,
                            &["input", "state"],
                            diagnostics,
                            &format!("{name} reject"),
                        );
                    }
                }
            } else if let Some(event) = handler.get("event").and_then(Json::as_str) {
                if !events.contains(event) {
                    diagnostics.push(located(
                        handler,
                        format!("{name}.{state_name} handles unknown event {event}"),
                    ));
                }
                for assignment in handler
                    .get("set")
                    .and_then(Json::as_array)
                    .into_iter()
                    .flatten()
                {
                    let field = assignment.get("field").and_then(Json::as_str).unwrap_or("");
                    if !field_names.contains(field) {
                        diagnostics.push(located(
                            assignment,
                            format!("field {field} is not declared on {name}"),
                        ));
                    }
                    expect_scope(
                        assignment.get("expression").unwrap_or(&Json::Null),
                        &["input", "state"],
                        diagnostics,
                        &format!("{name} set {field}"),
                    );
                }
                if let Some(target) = handler.get("move").and_then(Json::as_str) {
                    if !state_names.contains(target) {
                        diagnostics.push(located(
                            handler,
                            format!("{name} moves to unknown state {target}"),
                        ));
                    }
                }
            }
        }
    }
}

fn check_manager(
    module: &Json,
    manager: &Json,
    aggregates: &BTreeMap<String, Json>,
    contexts: &BTreeMap<String, String>,
    diagnostics: &mut Vec<String>,
) {
    let name = manager
        .get("name")
        .and_then(Json::as_str)
        .unwrap_or("manager");
    let mut ports = BTreeMap::new();
    let mut port_names = BTreeSet::new();
    for parameter in manager
        .get("parameters")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
    {
        let parameter_name = parameter.get("name").and_then(Json::as_str).unwrap_or("");
        let parameter_type = parameter.get("type").and_then(Json::as_str).unwrap_or("");
        if !port_names.insert(parameter_name.to_string()) {
            diagnostics.push(located(
                parameter,
                format!("Manager {name} parameter {parameter_name} is declared more than once"),
            ));
        }
        if port_names.contains(parameter_type) && parameter_type == parameter_name {
            // A port may share its component's declared name only as the type,
            // never as both the field and the port. Managers have no fields.
        }
        let Some(aggregate) = aggregates.get(parameter_type) else {
            diagnostics.push(located(
                parameter,
                format!(
                    "Manager {name} parameter {parameter_name} must bind an aggregate declaration"
                ),
            ));
            continue;
        };
        if contexts.get(parameter_type) != contexts.get(name) {
            diagnostics.push(located(
                parameter,
                format!(
                    "Manager {name} cannot bind aggregate {parameter_type} outside its context"
                ),
            ));
        }
        let _ = module;
        ports.insert(parameter_name.to_string(), aggregate.clone());
    }
    let mut operations = BTreeSet::new();
    for operation in manager
        .get("operations")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
    {
        let operation_name = operation.get("name").and_then(Json::as_str).unwrap_or("");
        if !operations.insert(operation_name.to_string()) {
            diagnostics.push(located(
                operation,
                format!("Manager {name} operation {operation_name} is declared more than once"),
            ));
        }
        let target = operation
            .get("aggregateParameter")
            .and_then(Json::as_str)
            .unwrap_or("");
        let Some(aggregate) = ports.get(target) else {
            let message = if aggregates.contains_key(target) {
                format!("send names component {target}; name the port that holds it")
            } else {
                format!("Manager {name}.{operation_name} sends to unbound port {target}")
            };
            diagnostics.push(located(operation, message));
            continue;
        };
        let command = operation
            .get("command")
            .and_then(Json::as_str)
            .unwrap_or("");
        if !names_of(aggregate, "commands").contains(command) {
            let aggregate_name = aggregate.get("name").and_then(Json::as_str).unwrap_or("");
            diagnostics.push(located(
                operation,
                format!(
                    "Manager {name}.{operation_name} sends undeclared command {aggregate_name}.{command}"
                ),
            ));
        }
        expect_scope(
            operation.get("identity").unwrap_or(&Json::Null),
            &["input"],
            diagnostics,
            &format!("{name}.{operation_name} identity"),
        );
        expect_scope(
            operation.get("payload").unwrap_or(&Json::Null),
            &["input"],
            diagnostics,
            &format!("{name}.{operation_name} payload"),
        );
    }
}

fn check_controller(
    controller: &Json,
    managers: &BTreeMap<String, Json>,
    contexts: &BTreeMap<String, String>,
    diagnostics: &mut Vec<String>,
) {
    let name = controller
        .get("name")
        .and_then(Json::as_str)
        .unwrap_or("controller");
    let mut ports = BTreeMap::new();
    for parameter in controller
        .get("parameters")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
    {
        let parameter_name = parameter.get("name").and_then(Json::as_str).unwrap_or("");
        let parameter_type = parameter.get("type").and_then(Json::as_str).unwrap_or("");
        let Some(manager) = managers.get(parameter_type) else {
            diagnostics.push(located(
                parameter,
                format!(
                    "Controller {name} parameter {parameter_name} must bind a manager declaration"
                ),
            ));
            continue;
        };
        if contexts.get(parameter_type) != contexts.get(name) {
            diagnostics.push(located(
                parameter,
                format!(
                    "Controller {name} cannot bind manager {parameter_type} outside its context"
                ),
            ));
        }
        ports.insert(parameter_name.to_string(), manager.clone());
    }
    for route in controller
        .get("routes")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
    {
        let method = route.get("method").and_then(Json::as_str).unwrap_or("");
        let path = route.get("path").and_then(Json::as_str).unwrap_or("");
        if route.get("public").and_then(Json::as_bool) != Some(true) {
            diagnostics.push(located(
                route,
                format!(
                    "Route {method} {path} must declare public access; authentication is not supported in this compiler"
                ),
            ));
        }
        let operation = segments(route.get("operation").unwrap_or(&Json::Null));
        let manager = operation.first().and_then(|name| ports.get(name));
        let operation_name = operation.get(1).map(String::as_str);
        let known = manager.is_some_and(|manager| {
            operation.len() == 2
                && operation_name.is_some_and(|operation_name| {
                    names_of(manager, "operations").contains(operation_name)
                })
        });
        if !known {
            diagnostics.push(located(
                route,
                format!(
                    "Controller {name} route sends to unknown operation {}",
                    operation.join(".")
                ),
            ));
        } else if operation
            .first()
            .is_some_and(|name| managers.contains_key(name))
            && !ports.contains_key(operation.first().unwrap())
        {
            diagnostics.push(located(
                route,
                format!(
                    "send names component {}; name the manager port",
                    operation.first().unwrap()
                ),
            ));
        }
        expect_scope(
            route.get("input").unwrap_or(&Json::Null),
            &["request"],
            diagnostics,
            &format!("route {method} {path}"),
        );
        if references_name(route.get("input").unwrap_or(&Json::Null), "principal") {
            diagnostics.push(located(route, "A public route must not refer to principal"));
        }
    }
}

fn expect_scope(value: &Json, allowed: &[&str], diagnostics: &mut Vec<String>, label: &str) {
    if value.is_null() {
        return;
    }
    if let Err(error) = kith_runtime::host::parse_expression(value) {
        diagnostics.push(format!("{label}: {error}"));
        return;
    }
    let mut names = Vec::new();
    collect_references(value, &mut names);
    for name in names {
        if !allowed.contains(&name.as_str()) {
            diagnostics.push(format!("{label} refers to unknown value ${name}"));
        }
    }
}

fn references_name(value: &Json, expected: &str) -> bool {
    let mut names = Vec::new();
    collect_references(value, &mut names);
    names.iter().any(|name| name == expected)
}

fn names_of(value: &Json, key: &str) -> BTreeSet<String> {
    value
        .get(key)
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(Json::as_str))
        .map(str::to_string)
        .collect()
}

fn duplicate(items: &[Json], key: &str, label: &str, diagnostics: &mut Vec<String>) {
    let mut seen = BTreeSet::new();
    for item in items {
        let Some(name) = item.get(key).and_then(Json::as_str) else {
            continue;
        };
        if !seen.insert(name.to_string()) {
            diagnostics.push(located(item, format!("duplicate {label} {name}")));
        }
    }
}

fn domain_map(module: &Json, expected: &str) -> BTreeMap<String, Json> {
    declarations(module)
        .filter(|declaration| kind(declaration) == Some(expected))
        .filter_map(|declaration| {
            declaration
                .get("name")
                .and_then(Json::as_str)
                .map(|name| (name.to_string(), declaration.clone()))
        })
        .collect()
}

fn export_names(module: &Json) -> BTreeSet<String> {
    declarations(module)
        .filter(|declaration| kind(declaration) == Some("export"))
        .filter_map(|declaration| declaration.get("name").and_then(Json::as_str))
        .map(str::to_string)
        .collect()
}

fn import_names(module: &Json) -> BTreeSet<String> {
    declarations(module)
        .filter(|declaration| kind(declaration) == Some("import"))
        .flat_map(|declaration| {
            declaration
                .get("names")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
                .filter_map(Json::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn is_builtin_kind(kind: &str) -> bool {
    matches!(kind, "Web" | "Worker" | "Job" | "Events")
}

fn entry_section(kind: &str) -> Option<&'static str> {
    match kind {
        "Web" => Some("controllers"),
        "Worker" => Some("consumers"),
        "Job" => Some("jobs"),
        "Events" => Some("reactors"),
        _ => None,
    }
}

fn section_allowed(kind: &str, section: &str) -> bool {
    matches!(section, "services" | "repositories" | "managers")
        || entry_section(kind) == Some(section)
}

fn array_len(value: &Json, key: &str) -> usize {
    value
        .get(key)
        .and_then(Json::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn kind(value: &Json) -> Option<&str> {
    value.get("kind").and_then(Json::as_str)
}

fn located(value: &Json, message: impl Into<String>) -> String {
    let message = message.into();
    let Some(span) = value.get("span") else {
        return message;
    };
    let source = span.get("source").and_then(Json::as_str).unwrap_or("");
    let line = span
        .pointer("/start/line")
        .and_then(Json::as_u64)
        .unwrap_or(0);
    let column = span
        .pointer("/start/column")
        .and_then(Json::as_u64)
        .unwrap_or(0);
    if source.is_empty() {
        message
    } else {
        format!("{source}:{}:{}: {message}", line + 1, column + 1)
    }
}
