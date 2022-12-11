import { CompletionItemProvider as VSCompletionItemProvider, CancellationToken, Position , ProviderResult, TextDocument, CompletionContext, CompletionItem, CompletionItemKind, CompletionList, Range, workspace} from 'vscode';

import * as path from 'path';

const regex_start = /(?<={include\s+|file=)['"]([^'"\s]+)$/;

export class CompletionItemProvider implements VSCompletionItemProvider {

	async provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext) {

		const line = document.lineAt(position.line);
		const textBefore = document.getText(
			new Range(line.range.start, position)
		);

		const m = textBefore.match(regex_start);
		if (!m) {
			return [];
		}

		const file = m[1];

		// TODO: Support non-relative paths
		if (!file.startsWith('./')) {
			return [];
		}

		// Current file directory path
		const docdir = path.dirname(document.uri.path);

		// Get directories only
		const sub = file.replace(/[^\/]+$/, '');

		// Get absolute path to subdirectory
		const dir = path.posix.resolve(docdir, sub);

		const fillStart = line.range.start.translate(0, m.index).translate(0, sub.length + 1);
		const fillRange = new Range(fillStart, position);

		const items = [];
		const addedDirs = [];
		const subFiles = await workspace.findFiles(`${workspace.asRelativePath(dir)}/**/*.tpl`);
		for (const f of subFiles) {
			const rel = path.relative(dir, f.fsPath);

			// Is inside subdirectory
			if (rel.includes('/')) {
				const dr = rel.replace(/\/.+/, '');

				// Directory not yet added
				if (!addedDirs.includes(dr)) {
					addedDirs.push(dr);

					const item = new CompletionItem(`${dr}/`, CompletionItemKind.Folder);
					item.range = fillRange;

					items.push(item);
				}

				continue;
			}

			const item = new CompletionItem(rel, CompletionItemKind.File);
			item.range = fillRange;

			items.push(item);
		}

		console.log(items);


		return items;
	}

	resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem> {
		return item;
	}

}
