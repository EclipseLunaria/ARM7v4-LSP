/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true,
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false,
			},
		},
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true,
			},
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders((_event) => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}
	// Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
	// We could optimize things here and re-fetch the setting first can compare it
	// to the existing setting, but this is out of scope for this example.
	connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample',
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose((e) => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	validateTextDocument(change.document);
});

function validateTextDocument(textDocument: TextDocument) {
	const text = textDocument.getText(); // Get the content of the file
	const diagnostics = []; // List of diagnostics (errors)

	// Split text into lines and check each line
	const lines = text.split(/\r?\n/g);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Example syntax validation for ARM7TDMI instructions
		if (!/^\s*(MOV|ADD|SUB|LDR|STR|B)\s/.test(line)) {
			// If the line does not start with a valid instruction, create an error
			const diagnostic = {
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: i, character: 0 },
					end: { line: i, character: line.length },
				},
				message: `Unknown instruction or syntax error: '${line}'`,
				source: 'arm-lsp',
			};
			diagnostics.push(diagnostic);
		}
	}

	// Send the diagnostics back to the client
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// Listen for hover requests (provides information about the instruction)
connection.onHover((params) => {
	const { position, textDocument } = params;
	const document = documents.get(textDocument.uri);
	const text = document!.getText().split(/\r?\n/g)[position.line];

	// Example hover information for "MOV" instruction
	if (text.startsWith('MOV')) {
		return {
			contents: {
				kind: 'markdown',
				value: 'MOV: Move value to register',
			},
		};
	}
});
connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log('We received a file change event');
});
connection.onCompletion(() => {
	return [
		{ label: 'MOV', kind: 1, detail: 'Move value to register' },
		{ label: 'ADD', kind: 1, detail: 'Add two registers' },
		{ label: 'SUB', kind: 1, detail: 'Subtract two registers' },
		{ label: 'LDR', kind: 1, detail: 'Load value from memory' },
		{ label: 'STR', kind: 1, detail: 'Store value to memory' },
		{ label: 'B', kind: 1, detail: 'Branch to address' },
	];
});

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.data === 1) {
		item.detail = 'TypeScript details';
		item.documentation = 'TypeScript documentation';
	} else if (item.data === 2) {
		item.detail = 'JavaScript details';
		item.documentation = 'JavaScript documentation';
	}
	return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
