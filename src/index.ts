/**
 * openapi-cli-kit: CLIs described by OpenAPI 3.1 documents with the `x-cli-*` extensions (SPEC.md). One runner reads
 * the document, parses the arguments, prints help and maps outcomes to exit codes; you write each command's handler.
 */
export { CliError } from './runner/errors.ts';
export { coerce, parseArgs, parseDuration, usageLine, type ParsedArgs } from './runner/argv.ts';
export { commandHelp, isReadOnly, overviewHelp, typeLabel } from './runner/help.ts';
export { EXTENSIONS_SCHEMA, lintSpec, schemaProblems } from './runner/lint.ts';
export { plainText, runCli, type Handler, type HandlerInput, type HandlerResult, type Handlers, type Io } from './runner/run.ts';
export {
  METHODS,
  commands,
  commandsUnder,
  deref,
  findCommand,
  loadSpec,
  pathSegments,
  responseFor,
  type CliSpec,
  type Command,
  type JsonSchema,
  type Method,
  type Operation,
  type Parameter,
  type ResponseObject,
} from './runner/spec.ts';
export {
  STANDARD_RESPONSES,
  STANDARD_SCHEMAS,
  buildSpec,
  type ArgDef,
  type CliDef,
  type CliProfileDef,
  type FlagDef,
  type OpDef,
  type StandardResponse,
} from './dsl.ts';
export { referenceText } from './reference.ts';
export { cliProblems, skillCalls, specText, writeCli, type CliEntry } from './project.ts';
export { processIo, readStdin, runProcess } from './process.ts';
export {
  MCP_PROTOCOL_VERSION,
  McpClient,
  expandEnv,
  kebab,
  mcpArguments,
  mcpCommands,
  mcpHandlers,
  mcpResultText,
  withMcp,
  type McpCommand,
  type McpServer,
  type McpTool,
  type McpToolResult,
} from './mcp.ts';
