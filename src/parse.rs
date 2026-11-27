use crate::error::Error;
use serde_json::Value as Json;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use uffda_runtime::module::CompiledModuleGraph;
use uffda_runtime::pattern::MatchKind;
use uffda_runtime::resolver::packages::{JsrPackages, Lockfile};
use uffda_runtime::resolver::Resolver;
use uffda_runtime::runtime::{InputMode, Runtime};
use url::Url;

include!(concat!(env!("OUT_DIR"), "/languages.rs"));

#[derive(Clone)]
struct Language {
    graph: Rc<CompiledModuleGraph>,
    entry: Url,
}

thread_local! {
    static LANGUAGE: RefCell<Option<Result<Language, String>>> = const { RefCell::new(None) };
}

struct SpanHit {
    name: String,
    start: usize,
    end: usize,
}

struct SpanCatalog {
    spans: BTreeMap<String, Vec<(usize, usize)>>,
    index: BTreeMap<String, usize>,
}

impl SpanCatalog {
    fn from_hits(hits: Vec<SpanHit>) -> Self {
        let mut spans: BTreeMap<String, Vec<(usize, usize)>> = BTreeMap::new();
        for hit in hits {
            spans
                .entry(hit.name)
                .or_default()
                .push((hit.start, hit.end));
        }
        Self {
            spans,
            index: BTreeMap::new(),
        }
    }

    fn take(&mut self, name: &str) -> Option<(usize, usize)> {
        let slots = self.spans.get(name)?;
        let cursor = self.index.entry(name.to_string()).or_insert(0);
        let span = slots.get(*cursor).copied();
        if span.is_some() {
            *cursor += 1;
        }
        span
    }

    fn take_next(&mut self, names: &[&str]) -> Option<(usize, usize)> {
        let mut best: Option<(&str, usize, usize)> = None;
        for name in names {
            let Some(slots) = self.spans.get(*name) else {
                continue;
            };
            let cursor = self.index.get(*name).copied().unwrap_or(0);
            let Some((start, end)) = slots.get(cursor).copied() else {
                continue;
            };
            let replace = best.is_none_or(|(_, best_start, _)| start < best_start);
            if replace {
                best = Some((name, start, end));
            }
        }
        let (name, start, end) = best?;
        *self.index.entry(name.to_string()).or_insert(0) += 1;
        Some((start, end))
    }
}

const EXPORT_RULES: &[&str] = &[
    "ExportedShape",
    "ExportedConfig",
    "ExportedMode",
    "ExportedProgram",
    "ExportedContext",
    "ExportedAggregate",
    "ExportedManager",
    "ExportedController",
    "ExportName",
    "ExportDeclarationSyntax",
];

pub fn parse_source(source: &str, name: &str) -> Result<Json, Error> {
    let language = language()?;
    let mut runtime = Runtime::with_mode(
        Rc::clone(&language.graph),
        &language.entry,
        Some("ColeslawLang"),
        serde_json::json!(source),
        InputMode::Scalar,
    )
    .map_err(|error| Error::new(error.to_string()))?;
    runtime
        .run()
        .map_err(|error| Error::new(error.to_string()))?;
    let failed = runtime.read(|execution| {
        let Some(matched) = execution.result() else {
            return Some("Coleslaw parse produced no result".to_string());
        };
        if matched.recovered {
            return Some(format!("{name}: recovered input is not a successful parse"));
        }
        if matched.kind == MatchKind::Ok {
            None
        } else {
            let diagnostics = execution.diagnostics();
            Some(if diagnostics.is_empty() {
                format!("{name}:1:1: offset 0: Coleslaw source did not match the grammar")
            } else {
                diagnostics
                    .into_iter()
                    .map(|diagnostic| {
                        let offset = diagnostic.span.start;
                        let (line, column) = line_column(source, offset);
                        format!(
                            "{name}:{}:{}: offset {offset}: {}",
                            line + 1,
                            column + 1,
                            diagnostic.message
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
        }
    });
    if let Some(message) = failed {
        return Err(Error::new(message));
    }
    let spans = runtime.read(|execution| {
        let mut hits = Vec::new();
        if let Some(matched) = execution.result() {
            collect_spans(&matched, &language.graph, &mut hits);
        }
        hits
    });
    let tree = if let Ok(Some(serialized)) = runtime.serialize_result() {
        serde_json::from_str::<Json>(&serialized).map_err(|error| Error::new(error.to_string()))?
    } else {
        return Err(Error::new("Coleslaw parse produced no syntax tree"));
    };
    let mut tree = tree;
    if let Some(object) = tree.as_object_mut() {
        object.insert("source".into(), Json::String(name.to_string()));
    }
    let mut catalog = SpanCatalog::from_hits(spans);
    attach_spans(&mut tree, &mut catalog, name, source);
    Ok(tree)
}

pub fn project_pattern(pattern: &Json, input: &Json) -> Result<Option<Json>, Error> {
    let pattern = kith_runtime::host::parse_pattern(pattern)
        .map_err(|error| Error::new(error.to_string()))?;
    let input = to_uffda_json(input)?;
    let mut runtime = Runtime::for_pattern(pattern, input, InputMode::Scalar)
        .map_err(|error| Error::new(error.to_string()))?;
    runtime
        .run()
        .map_err(|error| Error::new(error.to_string()))?;
    let matched = runtime.read(|execution| {
        execution
            .result()
            .is_some_and(|matched| matched.kind == MatchKind::Ok && !matched.recovered)
    });
    if !matched {
        return Ok(None);
    }
    let Some(serialized) = runtime
        .serialize_result()
        .map_err(|error| Error::new(error.to_string()))?
    else {
        return Ok(None);
    };
    serde_json::from_str(&serialized)
        .map(Some)
        .map_err(|error| Error::new(error.to_string()))
}

fn to_uffda_json(value: &Json) -> Result<uffda_runtime::json::JsonValue, Error> {
    use uffda_runtime::json::{JsonValue, ObjectMap};
    Ok(match value {
        Json::Null => JsonValue::Null,
        Json::Bool(value) => JsonValue::Bool(*value),
        Json::Number(value) => JsonValue::Number(value.clone()),
        Json::String(value) => JsonValue::String(value.as_str().into()),
        Json::Array(items) => JsonValue::Array(
            items
                .iter()
                .map(to_uffda_json)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Json::Object(entries) => {
            let mut object = ObjectMap::new();
            for (key, value) in entries {
                object.insert(key.as_str().into(), to_uffda_json(value)?);
            }
            JsonValue::Object(object)
        }
    })
}

pub fn parse_file(path: &Path) -> Result<Json, Error> {
    let source = std::fs::read_to_string(path)
        .map_err(|error| Error::new(format!("cannot read {}: {error}", path.display())))?;
    parse_source(&source, &path.display().to_string())
}

fn language() -> Result<Language, Error> {
    LANGUAGE.with(|slot| {
        if slot.borrow().is_none() {
            *slot.borrow_mut() = Some(load_language());
        }
        match slot.borrow().as_ref() {
            Some(Ok(language)) => Ok(language.clone()),
            Some(Err(error)) => Err(Error::new(error.clone())),
            None => Err(Error::new("Coleslaw language failed to load")),
        }
    })
}

fn load_language() -> Result<Language, String> {
    let mut resolver = Resolver::from_cwd().map_err(|error| error.to_string())?;
    let root = Url::parse("file:///coleslaw/builtin/").map_err(|error| error.to_string())?;
    if DECLARATIONS.is_empty() {
        return Err("embedded Coleslaw grammar is missing".into());
    }
    for (path, source) in DECLARATIONS {
        let url = root.join(path).map_err(|error| error.to_string())?;
        resolver.insert_declaration_codec_source(url, source);
    }
    let packages = JsrPackages::standard(lockfile()).map_err(|error| error.to_string())?;
    resolver.set_packages(packages);
    resolver
        .set_import_map(import_map()?)
        .map_err(|error| error.to_string())?;
    let path = DECLARATIONS
        .iter()
        .map(|(path, _)| *path)
        .find(|path| path.ends_with("application.uff"))
        .ok_or_else(|| "embedded Coleslaw language module is missing".to_string())?;
    let entry = root.join(path).map_err(|error| error.to_string())?;
    let graph = resolver
        .load_graph(&entry)
        .map_err(|error| error.to_string())?;
    let graph = Rc::new(CompiledModuleGraph::compile(graph).map_err(|error| error.to_string())?);
    Ok(Language { graph, entry })
}

fn lockfile() -> Lockfile {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("uffda.lock");
    Lockfile::load(manifest).unwrap_or_else(|_| Lockfile::memory())
}

fn import_map() -> Result<BTreeMap<String, String>, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("uffda.jsonc");
    let text = std::fs::read_to_string(&manifest).map_err(|error| error.to_string())?;
    let value: Json = serde_json::from_str(&strip_jsonc(&text))
        .map_err(|error| format!("uffda.jsonc: {error}"))?;
    let mut imports = BTreeMap::new();
    let Some(map) = value.get("imports").and_then(Json::as_object) else {
        return Err("uffda.jsonc is missing imports".into());
    };
    for (name, specifier) in map {
        let Some(specifier) = specifier.as_str() else {
            return Err(format!("uffda.jsonc import {name} is not a string"));
        };
        imports.insert(name.clone(), specifier.to_string());
    }
    Ok(imports)
}

fn strip_jsonc(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if ch == '\\' {
                if let Some(escaped) = chars.next() {
                    out.push(escaped);
                }
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(ch);
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'/') {
            chars.next();
            for next in chars.by_ref() {
                if next == '\n' {
                    out.push('\n');
                    break;
                }
            }
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            while let Some(next) = chars.next() {
                if next == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    break;
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

fn collect_spans(
    matched: &uffda_runtime::pattern::PatternMatch<'_>,
    graph: &CompiledModuleGraph,
    hits: &mut Vec<SpanHit>,
) {
    if matches!(matched.kind, MatchKind::Ok | MatchKind::Skip) {
        if let Some(rule) = matched.rule.as_ref() {
            if let Some(declaration) = graph.declaration(&rule.member) {
                hits.push(SpanHit {
                    name: declaration.name.clone(),
                    start: matched.origin.start,
                    end: matched.origin.end,
                });
            }
        }
    }
    for child in matched.children.as_slice() {
        collect_spans(child, graph, hits);
    }
}

fn attach_spans(tree: &mut Json, catalog: &mut SpanCatalog, name: &str, source: &str) {
    let Some(declarations) = tree.get_mut("declarations").and_then(Json::as_array_mut) else {
        return;
    };
    for declaration in declarations {
        attach_declaration(declaration, catalog, name, source);
    }
}

fn attach_declaration(value: &mut Json, catalog: &mut SpanCatalog, name: &str, source: &str) {
    let kind = value
        .get("kind")
        .and_then(Json::as_str)
        .unwrap_or("")
        .to_string();
    let rule = match kind.as_str() {
        "import" => Some("ImportDeclarationSyntax"),
        "export" => None,
        "config" => Some("ConfigDeclaration"),
        "shape" => Some("ShapeDeclaration"),
        "mode" => Some("ModeDeclaration"),
        "program" => Some("ProgramDeclaration"),
        "context" => Some("ContextDeclaration"),
        "aggregate" => Some("AggregateDeclaration"),
        "manager" => Some("ManagerDeclaration"),
        "controller" => Some("ControllerDeclaration"),
        _ => None,
    };
    let chosen = if kind == "export" {
        catalog.take_next(EXPORT_RULES)
    } else {
        rule.and_then(|rule| catalog.take(rule))
    };
    if let Some(span) = chosen {
        insert_span(value, name, source, span);
    }
    match kind.as_str() {
        "config" => attach_members(value, "settings", catalog, name, source),
        "mode" => {
            attach_array_rule(value, "parameters", "ModeParameter", catalog, name, source);
            if let Some(kind) = value.get_mut("modeKind") {
                if kind.as_object().is_some() {
                    attach_name_path(kind, catalog, name, source);
                }
            }
            if let Some(sections) = value.get_mut("sections").and_then(Json::as_array_mut) {
                for section in sections {
                    if let Some(span) = catalog.take("CompositionSection") {
                        insert_span(section, name, source, span);
                    }
                    if let Some(bindings) = section.get_mut("bindings").and_then(Json::as_array_mut)
                    {
                        for binding in bindings {
                            if let Some(span) = catalog.take("ComponentBinding") {
                                insert_span(binding, name, source, span);
                            }
                            if let Some(component) = binding.get_mut("component") {
                                attach_name_path(component, catalog, name, source);
                            }
                        }
                    }
                }
            }
        }
        "program" => {
            if let Some(config) = value.get_mut("config") {
                attach_name_path(config, catalog, name, source);
            }
            if let Some(selector) = value.get_mut("selector") {
                attach_name_path(selector, catalog, name, source);
            }
            if let Some(positionals) = value.get_mut("positionals").and_then(Json::as_array_mut) {
                for positional in positionals {
                    if let Some(span) = catalog.take("PositionalBinding") {
                        insert_span(positional, name, source, span);
                    }
                    if let Some(setting) = positional.get_mut("setting") {
                        attach_name_path(setting, catalog, name, source);
                    }
                }
            }
            if let Some(selections) = value.get_mut("selections").and_then(Json::as_array_mut) {
                for selection in selections {
                    if let Some(span) = catalog.take("ModeSelection") {
                        insert_span(selection, name, source, span);
                    }
                    if let Some(mode) = selection.get_mut("mode") {
                        attach_name_path(mode, catalog, name, source);
                    }
                }
            }
        }
        "aggregate" => attach_aggregate(value, catalog, name, source),
        "context" => {
            if let Some(members) = value.get_mut("members").and_then(Json::as_array_mut) {
                for member in members {
                    if let Some(span) = catalog.take("ContextMember") {
                        insert_span(member, name, source, span);
                    }
                }
            }
        }
        "manager" => {
            attach_array_rule(
                value,
                "parameters",
                "DomainParameter",
                catalog,
                name,
                source,
            );
            if let Some(operations) = value.get_mut("operations").and_then(Json::as_array_mut) {
                for operation in operations {
                    if let Some(span) = catalog.take("ManagerOperation") {
                        insert_span(operation, name, source, span);
                    }
                }
            }
        }
        "controller" => {
            attach_array_rule(
                value,
                "parameters",
                "DomainParameter",
                catalog,
                name,
                source,
            );
            if let Some(routes) = value.get_mut("routes").and_then(Json::as_array_mut) {
                for route in routes {
                    if let Some(span) = catalog.take("ControllerRoute") {
                        insert_span(route, name, source, span);
                    }
                }
            }
        }
        _ => {}
    }
}

fn attach_members(
    value: &mut Json,
    key: &str,
    catalog: &mut SpanCatalog,
    name: &str,
    source: &str,
) {
    let Some(members) = value.get_mut(key).and_then(Json::as_array_mut) else {
        return;
    };
    for member in members {
        let kind = member
            .get("kind")
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string();
        let rule = if kind == "group" {
            "SettingGroup"
        } else {
            "Setting"
        };
        if let Some(span) = catalog.take(rule) {
            insert_span(member, name, source, span);
        }
        if kind == "group" {
            attach_members(member, "settings", catalog, name, source);
        }
    }
}

fn attach_aggregate(value: &mut Json, catalog: &mut SpanCatalog, name: &str, source: &str) {
    let start = value
        .get("start")
        .and_then(Json::as_str)
        .unwrap_or("")
        .to_string();
    let identity_name = value
        .get("identityField")
        .and_then(Json::as_str)
        .unwrap_or("")
        .to_string();
    if let Some(fields) = value.get_mut("fields").and_then(Json::as_array_mut) {
        for field in fields {
            let rule = if field.get("name").and_then(Json::as_str) == Some(identity_name.as_str()) {
                "AggregateIdentity"
            } else {
                "AggregateField"
            };
            if let Some(span) = catalog.take(rule) {
                insert_span(field, name, source, span);
            }
        }
    }
    attach_array_rule(value, "commands", "AggregateCommand", catalog, name, source);
    attach_array_rule(value, "events", "AggregateEvent", catalog, name, source);
    if let Some(states) = value.get_mut("states").and_then(Json::as_array_mut) {
        for state in states {
            let state_name = state.get("name").and_then(Json::as_str).unwrap_or("");
            let state_span = catalog.take("AggregateState");
            let span = if state_name == start {
                catalog.take("AggregateStartState").or(state_span)
            } else {
                state_span
            };
            if let Some(span) = span {
                insert_span(state, name, source, span);
            }
            attach_state_handlers(state, catalog, name, source);
        }
    }
}

fn attach_state_handlers(state: &mut Json, catalog: &mut SpanCatalog, name: &str, source: &str) {
    let Some(handlers) = state.get_mut("handlers").and_then(Json::as_array_mut) else {
        return;
    };
    for handler in handlers {
        if handler.get("command").is_some() {
            let decision = handler
                .get("decision")
                .and_then(|decision| decision.get("kind"))
                .and_then(Json::as_str);
            let rule = if decision == Some("reject") {
                "AggregateCommandReject"
            } else {
                "AggregateCommandEvent"
            };
            if let Some(span) = catalog.take(rule) {
                insert_span(handler, name, source, span);
            }
            if let Some(events) = handler
                .get_mut("decision")
                .and_then(|decision| decision.get_mut("events"))
                .and_then(Json::as_array_mut)
            {
                for event in events {
                    if let Some(span) = catalog.take("AggregateEmittedEvent") {
                        insert_span(event, name, source, span);
                    }
                }
            }
        } else {
            if let Some(span) = catalog.take("AggregateEventHandler") {
                insert_span(handler, name, source, span);
            }
            if let Some(assignments) = handler.get_mut("set").and_then(Json::as_array_mut) {
                for assignment in assignments {
                    if let Some(span) = catalog.take("AggregateSetField") {
                        insert_span(assignment, name, source, span);
                    }
                }
            }
        }
    }
}

fn attach_array_rule(
    value: &mut Json,
    key: &str,
    rule: &str,
    catalog: &mut SpanCatalog,
    name: &str,
    source: &str,
) {
    let Some(items) = value.get_mut(key).and_then(Json::as_array_mut) else {
        return;
    };
    for item in items {
        if let Some(span) = catalog.take(rule) {
            insert_span(item, name, source, span);
        }
    }
}

fn attach_name_path(value: &mut Json, catalog: &mut SpanCatalog, name: &str, source: &str) {
    if let Some(span) = catalog
        .take("NamePath")
        .or_else(|| catalog.take("DomainNamePath"))
    {
        insert_span(value, name, source, span);
    }
}

fn insert_span(value: &mut Json, name: &str, source: &str, span: (usize, usize)) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let (start, end) = span;
    let (start_line, start_column) = line_column(source, start);
    let (end_line, end_column) = line_column(source, end);
    object.insert(
        "span".into(),
        serde_json::json!({
            "source": name,
            "start": { "offset": start, "line": start_line, "column": start_column },
            "end": { "offset": end, "line": end_line, "column": end_column }
        }),
    );
}

fn line_column(source: &str, offset: usize) -> (usize, usize) {
    let mut line = 0;
    let mut column = 0;
    for (index, ch) in source.char_indices() {
        if index >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            column = 0;
        } else {
            column += 1;
        }
    }
    (line, column)
}
