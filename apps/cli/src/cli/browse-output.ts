import { err, ok, type Result } from '@exitbook/foundation';

import { jsonSuccess, textSuccess, type CliCompletion } from './command.js';

export interface BuildBrowseJsonOrStaticCompletionInput<TSelected, TError> {
  createMissingDetailJsonError(this: void): TError;
  createMissingSelectedItemError(this: void): TError;
  detailJsonResult?: unknown;
  listJsonResult: unknown;
  metadata?: Record<string, unknown> | undefined;
  mode: 'json' | 'static';
  renderStaticDetail(this: void, selectedItem: TSelected): void;
  renderStaticList(this: void): void;
  selectedItem?: TSelected | undefined;
  staticKind: 'detail' | 'list';
}

export function buildBrowseJsonOrStaticCompletion<TSelected, TError>(
  input: BuildBrowseJsonOrStaticCompletionInput<TSelected, TError>
): Result<CliCompletion, TError> {
  if (input.mode === 'json') {
    if (input.staticKind === 'detail') {
      if (input.detailJsonResult === undefined) {
        return err(input.createMissingDetailJsonError());
      }

      return ok(jsonSuccess(input.detailJsonResult));
    }

    return ok(jsonSuccess(input.listJsonResult, input.metadata));
  }

  if (input.staticKind === 'detail') {
    if (input.selectedItem === undefined) {
      return err(input.createMissingSelectedItemError());
    }

    const selectedItem = input.selectedItem;
    return ok(
      textSuccess(() => {
        input.renderStaticDetail(selectedItem);
      })
    );
  }

  return ok(
    textSuccess(() => {
      input.renderStaticList();
    })
  );
}
