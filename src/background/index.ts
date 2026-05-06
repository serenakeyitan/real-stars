// Service worker entry point. Handles auth, API calls, and analysis on behalf
// of content scripts (which can't make cross-origin requests in MV3 with the
// same flexibility).

import { handleAnalyzeRepo, handleClearCache } from './analyze';
import { handleGetAuthState, handleStartDeviceFlow, handleLogout } from './auth';
import type { RuntimeMessage } from '@/shared/types';

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  (async () => {
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
        case 'start-device-flow':
          sendResponse(await handleStartDeviceFlow());
          break;
        case 'logout':
          await handleLogout();
          sendResponse({ ok: true });
          break;
        case 'clear-cache':
          await handleClearCache();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ error: `unknown message type: ${(message as RuntimeMessage).type}` });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sendResponse({ error: errorMessage });
    }
  })();
  return true; // keep channel open for async response
});
