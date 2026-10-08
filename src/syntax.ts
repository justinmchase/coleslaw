import type { Expression } from "@justinmchase/uffda/expression";
import type { Pattern } from "@justinmchase/uffda/pattern";

export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly source: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface NamePath {
  readonly segments: readonly string[];
  readonly span: SourceSpan;
}

export interface ImportDeclaration {
  readonly kind: "import";
  readonly specifier: string;
  readonly names: readonly string[];
  readonly span: SourceSpan;
}

export interface ExportDeclaration {
  readonly kind: "export";
  readonly name: string;
  readonly span: SourceSpan;
}

export type UffdaPatternNode = Pattern;
export type UffdaExpressionNode = Expression;

export interface SettingDeclaration {
  readonly kind: "setting";
  readonly name: string;
  readonly pattern: UffdaPatternNode;
  readonly secret: boolean;
  readonly span: SourceSpan;
}

export interface SettingGroupDeclaration {
  readonly kind: "group";
  readonly name: string;
  readonly settings: readonly ConfigMember[];
  readonly span: SourceSpan;
}

export type ConfigMember = SettingDeclaration | SettingGroupDeclaration;

export interface ConfigDeclaration {
  readonly kind: "config";
  readonly name: string;
  readonly settings: readonly ConfigMember[];
  readonly span: SourceSpan;
}

export interface ComponentArgument {
  readonly kind:
    | "reference"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "expression";
  readonly path?: NamePath;
  readonly value?: string | number | boolean | null;
  readonly expression?: UffdaExpressionNode;
  readonly span: SourceSpan;
}

export interface ComponentBinding {
  readonly component: NamePath;
  readonly arguments: readonly ComponentArgument[];
  readonly name: string;
  readonly span: SourceSpan;
}

export type CompositionSectionName =
  | "services"
  | "repositories"
  | "managers"
  | "controllers"
  | "jobs"
  | "consumers"
  | "reactors";

export interface CompositionSection {
  readonly kind: "section";
  readonly name: CompositionSectionName;
  readonly bindings: readonly ComponentBinding[];
  readonly span: SourceSpan;
}

export interface ModeDeclaration {
  readonly kind: "mode";
  readonly name: string;
  readonly modeKind: NamePath | "Web" | "Worker" | "Job" | "Events";
  readonly sections: readonly CompositionSection[];
  readonly span: SourceSpan;
}

export interface ModeSelection {
  readonly kind: "selection";
  readonly label: string;
  readonly mode: NamePath;
  readonly arguments: readonly ComponentArgument[];
  readonly span: SourceSpan;
}

export interface PositionalArgumentBinding {
  readonly kind: "positional";
  readonly index: number;
  readonly setting: NamePath;
  readonly span: SourceSpan;
}

export interface ProgramDeclaration {
  readonly kind: "program";
  readonly name: string;
  readonly config: NamePath;
  readonly configBinding: string;
  readonly selector: NamePath;
  readonly positionals: readonly PositionalArgumentBinding[];
  readonly selections: readonly ModeSelection[];
  readonly span: SourceSpan;
}

export type SyntaxDeclaration =
  | ImportDeclaration
  | ExportDeclaration
  | ConfigDeclaration
  | ModeDeclaration
  | ProgramDeclaration;

export interface SyntaxModule {
  readonly kind: "module";
  readonly source: string;
  readonly declarations: readonly SyntaxDeclaration[];
}

export interface RawNamePath {
  readonly segments: readonly string[];
  readonly span: SourceSpan;
}

export interface RawImportDeclaration {
  readonly kind: "import";
  readonly moduleUrl: string;
  readonly names: readonly string[];
  readonly span: SourceSpan;
}

export interface RawExportDeclaration {
  readonly kind: "export";
  readonly name: string;
  readonly span: SourceSpan;
}

export interface RawSettingDeclaration {
  readonly kind: "setting";
  readonly name: string;
  readonly pattern: UffdaPatternNode;
  readonly secret: boolean;
  readonly span: SourceSpan;
}

export interface RawSettingGroupDeclaration {
  readonly kind: "group";
  readonly name: string;
  readonly settings: readonly RawConfigMember[];
  readonly span: SourceSpan;
}

export type RawConfigMember =
  | RawSettingDeclaration
  | RawSettingGroupDeclaration;

export interface RawConfigDeclaration {
  readonly kind: "config";
  readonly name: string;
  readonly settings: readonly RawConfigMember[];
  readonly span: SourceSpan;
}

export interface RawComponentBinding {
  readonly component: RawNamePath;
  readonly arguments: readonly UffdaExpressionNode[];
  readonly name: string;
  readonly span: SourceSpan;
}

export interface RawCompositionSection {
  readonly kind: "section";
  readonly name: CompositionSectionName;
  readonly bindings: readonly RawComponentBinding[];
  readonly span: SourceSpan;
}

export interface RawModeDeclaration {
  readonly kind: "mode";
  readonly name: string;
  readonly modeKind: RawNamePath | "Web" | "Worker" | "Job" | "Events";
  readonly sections: readonly RawCompositionSection[];
  readonly span: SourceSpan;
}

export interface RawModeSelection {
  readonly kind: "selection";
  readonly label: string;
  readonly mode: RawNamePath;
  readonly arguments: readonly UffdaExpressionNode[];
  readonly span: SourceSpan;
}

export interface RawPositionalBinding {
  readonly index: number;
  readonly setting: RawNamePath;
  readonly span: SourceSpan;
}

export interface RawProgramDeclaration {
  readonly kind: "program";
  readonly name: string;
  readonly config: RawNamePath;
  readonly configBinding: string;
  readonly selector: RawNamePath;
  readonly positionals: readonly RawPositionalBinding[];
  readonly selections: readonly RawModeSelection[];
  readonly span: SourceSpan;
}

export interface RawContextDeclaration {
  readonly kind: "context";
  readonly name: string;
  readonly members: readonly RawContextMember[];
  readonly span: SourceSpan;
}

export interface RawContextMember {
  readonly name: string;
  readonly exported: boolean;
  readonly span: SourceSpan;
}

export interface RawAggregateField {
  readonly name: string;
  readonly pattern: UffdaPatternNode;
  readonly initial: UffdaExpressionNode;
  readonly span: SourceSpan;
}

export interface RawAggregateShape {
  readonly name: string;
  readonly pattern: UffdaPatternNode;
  readonly span: SourceSpan;
}

export interface RawAggregateCommandEvent {
  readonly name: string;
  readonly payload: UffdaExpressionNode;
  readonly span: SourceSpan;
}

export interface RawAggregateCommandHandler {
  readonly command: string;
  readonly guard?: UffdaPatternNode;
  readonly decision:
    | {
      readonly kind: "reject";
      readonly reason: UffdaExpressionNode;
    }
    | {
      readonly kind: "emit";
      readonly events: readonly RawAggregateCommandEvent[];
    };
  readonly span: SourceSpan;
}

export interface RawAggregateEventHandler {
  readonly event: string;
  readonly set: readonly {
    readonly field: string;
    readonly expression: UffdaExpressionNode;
    readonly span: SourceSpan;
  }[];
  readonly move?: string;
  readonly span: SourceSpan;
}

export interface RawAggregateState {
  readonly name: string;
  readonly commands: readonly RawAggregateCommandHandler[];
  readonly events: readonly RawAggregateEventHandler[];
  readonly span: SourceSpan;
}

export interface RawAggregateDeclaration {
  readonly kind: "aggregate";
  readonly name: string;
  readonly identityField: string;
  readonly fields: readonly RawAggregateField[];
  readonly commands: readonly RawAggregateShape[];
  readonly events: readonly RawAggregateShape[];
  readonly invariants: readonly UffdaPatternNode[];
  readonly start: string;
  readonly states: readonly RawAggregateState[];
  readonly span: SourceSpan;
}

export interface RawManagerOperation {
  readonly name: string;
  readonly input: UffdaPatternNode;
  readonly result: UffdaPatternNode;
  readonly aggregate: string;
  readonly command: string;
  readonly identity: UffdaExpressionNode;
  readonly payload: UffdaExpressionNode;
  readonly span: SourceSpan;
}

export interface RawManagerDeclaration {
  readonly kind: "manager";
  readonly name: string;
  readonly operations: readonly RawManagerOperation[];
  readonly span: SourceSpan;
}

export interface RawControllerRoute {
  readonly method: string;
  readonly path: string;
  readonly public: boolean;
  readonly operation: RawNamePath;
  readonly requestShapes: readonly {
    readonly kind: "path" | "query" | "headers" | "body";
    readonly pattern: UffdaPatternNode;
    readonly span: SourceSpan;
  }[];
  readonly input: UffdaExpressionNode;
  readonly span: SourceSpan;
}

export interface RawControllerDeclaration {
  readonly kind: "controller";
  readonly name: string;
  readonly routes: readonly RawControllerRoute[];
  readonly span: SourceSpan;
}

export type RawSyntaxDeclaration =
  | RawImportDeclaration
  | RawExportDeclaration
  | RawConfigDeclaration
  | RawModeDeclaration
  | RawProgramDeclaration
  | RawContextDeclaration
  | RawAggregateDeclaration
  | RawManagerDeclaration
  | RawControllerDeclaration;

export interface RawSyntaxModule {
  readonly kind: "module";
  readonly source: string;
  readonly declarations: readonly RawSyntaxDeclaration[];
  readonly span: SourceSpan;
}

export interface SyntaxDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly span?: SourceSpan;
}

export type ParseResult =
  | { readonly ok: true; readonly module: SyntaxModule }
  | {
    readonly ok: false;
    readonly diagnostics: readonly SyntaxDiagnostic[];
  };
