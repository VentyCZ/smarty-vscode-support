import * as path from "path";
import {
	CharacterPair,
	DecorationOptions,
	ExtensionContext,
	Hover,
	languages,
	MarkdownString,
	Range,
	TextDocument,
	window,
	workspace,
	commands,
	ConfigurationTarget,
} from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient";

import { BeautifyHTMLFormatter } from "./formatter";

const snippets = require("../../snippets/snippets.json");

interface HighlightColorConfig {
	light?: string,
	dark?: string
}

interface Configuration {
	highlight?: boolean,
	highlightColor?: HighlightColorConfig,
	tabSize?: number,
	insertSpaces?: boolean,
	indentInnerHtml?: boolean,
	maxPreserveNewLines?: number | null,
	preserveNewLines?: boolean,
	wrapLineLength?: number,
	wrapAttributes?: string,
	endWithNewline?: boolean
}

export const CONFIG: Configuration = {};

let smartyDecoration: any;
let editorRegistration: any;
let docRegistration: any;

let client: LanguageClient;

export function activate(context: ExtensionContext) {

	let timeout: NodeJS.Timer | undefined = undefined;
	let { activeTextEditor } = window;

	function setup() {
		const getConfig = workspace.getConfiguration();

		Object.assign(CONFIG, {
			highlight: getConfig.get("smarty.highlight"),
			highlightColor: getConfig.get("smarty.highlightColor") as HighlightColorConfig,
			tabSize: getConfig.get("editor.tabSize"),
			insertSpaces: getConfig.get("editor.insertSpaces"),
			indentInnerHtml: getConfig.get("html.format.indentInnerHtml"),
			maxPreserveNewLines: getConfig.get("html.format.maxPreserveNewLines"),
			preserveNewLines: getConfig.get("html.format.preserveNewLines"),
			wrapLineLength: getConfig.get("html.format.wrapLineLength"),
			wrapAttributes: getConfig.get("html.format.wrapAttributes"),
			endWithNewline: getConfig.get("html.format.endWithNewline"),
		});

		// validate highlightColor setting
		const hexRegex = /^#([A-Fa-f0-9]{8})$/i
		if (!hexRegex.test(CONFIG.highlightColor.light)) {
			CONFIG.highlightColor.light = "#FFFA0040";
			window.showWarningMessage("Invalid value for smarty.highlightColor.light setting (Default applied)");
		}
		if (!hexRegex.test(CONFIG.highlightColor.dark)) {
			CONFIG.highlightColor.dark = "#FFFFFF25";
			window.showWarningMessage("Invalid value for smarty.highlightColor.dark setting (Default applied)");
		}

		smartyDecoration && smartyDecoration.dispose();
		editorRegistration && editorRegistration.dispose();
		docRegistration && docRegistration.dispose();

		if (!CONFIG.highlight) {
			return;
		}

		// decorator type for smarty tag highlight
		smartyDecoration = window.createTextEditorDecorationType({
			light: { backgroundColor: CONFIG.highlightColor.light },
			dark: { backgroundColor: CONFIG.highlightColor.dark },
		});

		if (activeTextEditor) {
			triggerUpdateDecorations();
			setLanguageConfiguration();
		}

		editorRegistration = window.onDidChangeActiveTextEditor(editor => {
			activeTextEditor = editor;
			if (editor) {
				updateDecorations();
				setLanguageConfiguration();
			}
		}, null, context.subscriptions);

		docRegistration = workspace.onDidChangeTextDocument(event => {
			if (activeTextEditor && event.document === activeTextEditor.document) {
				triggerUpdateDecorations();
			}
		}, null, context.subscriptions);
	}

	// sets smarty background decoration
	function updateDecorations() {
		if (!activeTextEditor || activeTextEditor.document.languageId !== "smarty") {
			return;
		}
		const smartyRegExp = /({{?\*.*?\*}}?)|{{?[^}\n\s]([^{}]|{[^{}]*})*}}?/g;
		const docText = activeTextEditor.document.getText();
		const smartyTags: DecorationOptions[] = [];

		let match;
		while (match = smartyRegExp.exec(docText)) {
			const startPos = activeTextEditor.document.positionAt(match.index);
			const endPos = activeTextEditor.document.positionAt(match.index + match[0].length);
			const range = new Range(startPos, endPos);
			const rangeTxt = activeTextEditor.document.getText(range);
			const decoration = { range };

			// checking tag inside literal
			const prevRange = smartyTags[smartyTags.length - 1];
			const prevRangeTxt = prevRange ? activeTextEditor.document.getText(prevRange.range) : "";
			if (!prevRangeTxt.includes("{literal}") || rangeTxt.includes("{/literal}")) {
				smartyTags.push(decoration);
			}
		}
		activeTextEditor.setDecorations(smartyDecoration, smartyTags);
	}

	function triggerUpdateDecorations() {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		timeout = setTimeout(updateDecorations, 500);
	}

	// toggle configuration between {} and {{}} delimiters
	function setLanguageConfiguration() {
		let pair: CharacterPair = ["{*", "*}"];

		const doubleBraceRegExp = /({{\*.*?\*}})|{{[^}\n\s]([^{}]|{[^{}]*})*}}/m;
		const docText = activeTextEditor.document.getText();

		if (doubleBraceRegExp.exec(docText)) {
			pair = ["{{*", "*}}"];
		}

		languages.setLanguageConfiguration("smarty", {
			comments: { blockComment: pair }
		});
	}

	// smarty document formatting providers
	languages.registerDocumentFormattingEditProvider(
		{ scheme: "file", language: "smarty" },
		new BeautifyHTMLFormatter()
	);

	languages.registerDocumentRangeFormattingEditProvider(
		{ scheme: "file", language: "smarty" },
		new BeautifyHTMLFormatter()
	);

	// subscribe to configuration change
	workspace.onDidChangeConfiguration(event => {
		const configs: Array<any> = ["editor", "html.format", "smarty"];
		configs.some(config => event.affectsConfiguration(config)) && setup();
	});

	// smarty document hover provider
	languages.registerHoverProvider("smarty", {
		provideHover(document, position, token) {
			const range = document.getWordRangeAtPosition(position);
			const word = document.getText(range);
			const line = document.lineAt(position).text;

			if (!new RegExp("{/?" + word + "\\b").test(line) || !snippets[word]) {
				return null;
			}

			const snippet = snippets[word];

			if (!snippet.description.length) {
				return null;
			}

			const md = new MarkdownString();
			md.appendCodeblock(`{${word}}`);
			md.appendMarkdown(`${snippet.description}`);

			if (snippet.reference) {
				md.appendMarkdown(`\n\r[Smarty Reference](${snippet.reference})`);
			}
			return new Hover(md);
		}
	});

	// command to toggle highlight decoration
	commands.registerCommand("smarty.toggleHighlight", () => {
		const getConfig = workspace.getConfiguration('smarty');
		getConfig.update('highlight', !getConfig.get('highlight'), ConfigurationTarget.Global);
	});

	startClient(context);
	setup();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

function startClient(context: ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join("server", "out", "server.js")
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node"s Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: "file", language: "smarty" }],
		initializationOptions: {
			dataPaths: [],
			embeddedLanguages: { css: true, javascript: true }
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		"smarty",
		"Smarty Language Server",
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

export function fullDocumentRange(document: TextDocument): Range {
	const lastLineId = document.lineCount - 1;
	return new Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
}
