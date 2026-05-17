// Service worker entry point. Handles auth, API calls, and analysis on behalf
// of content scripts (which can't make cross-origin requests in MV3 with the
// same flexibility).

import { handleAnalyzeRepo, handleClearCache } from './analyze';
import { handleGetAuthState, handleSignIn, handleLogout } from './auth';
import type { RuntimeMessage } from '@/shared/types';

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  // Fire-and-forget is intentional and correct here: this is the canonical MV3
  // async-response pattern. We can't `await` the IIFE because the listener must
  // return synchronously; `return true` below keeps the message channel open
  // until the async work calls `sendResponse`. Errors are handled inside the
  // try/catch and reported back via `sendResponse`, so nothing is swallowed.
  void (async () => {
    try {
      switch (message.type) {
        case 'analyze-repo':
          sendResponse(
            await handleAnalyzeRepo(
              message.payload as { owner: string; repo: string; forceRefresh?: boolean },
            ),
          );
          break;
        case 'get-auth-state':
          sendResponse(await handleGetAuthState());
          break;
        case 'sign-in':
          sendResponse(await handleSignIn());
          break;
        case 'logout':
          await handleLogout();
          sendResponse({ ok: true });
          break;
        case 'clear-cache':
          await handleClearCache();
          sendResponse({ ok: true });
          break;
        default: {
          // Exhaustiveness check: `message.type` narrows to `never` here once
          // every RuntimeMessage variant is handled above. Adding a new variant
          // to the union without a case makes this assignment fail to compile.
          const _exhaustiveType: never = message.type;
          void _exhaustiveType;
          sendResponse({
            error: `unknown message type: ${String((message as { type?: unknown }).type)}`,
          });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sendResponse({ error: errorMessage });
    }
  })();
  return true; // keep channel open for async response
});
