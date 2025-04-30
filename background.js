// Background service worker to handle communication
chrome.runtime.onInstalled.addListener(() => {
  console.log("WebSteps extension installed successfully");
  // Initialize storage
  chrome.storage.local.get(["testCases"], (result) => {
    if (!result.testCases) {
      chrome.storage.local.set({ testCases: [] }, () => {
        console.log("Storage initialized");
      });
    }
  });
  isRecording = false;
  recordedActions = [];
});

// Store recorded actions in the background for persistence
let recordedActions = [];
// Store recording state
let isRecording = false;

// Listen for messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  if (message.type === "setRecordingState") {
    isRecording = message.isRecording;
    // Don't clear actions when stopping recording
    sendResponse({ success: true });
    return true;
  } else if (message.type === "getRecordingState") {
    sendResponse({ isRecording });
    return true;
  } else if (message.type === "storeActions") {
    recordedActions = message.actions;
    console.log("Stored actions in background:", recordedActions);
    sendResponse({ success: true });
    return true;
  } else if (message.type === "getRecordedActions") {
    sendResponse({ actions: recordedActions });
    return true;
  } else if (message.type === "downloadActions") {
    // Check if we have actions to download
    if (!recordedActions || recordedActions.length === 0) {
      console.error("No actions to download");
      sendResponse({ error: "No actions to download" });
      return true;
    }

    try {
      // Convert actions to JSON string
      const jsonString = JSON.stringify(recordedActions, null, 2);

      // Create a data URL
      const dataUrl =
        "data:application/json;charset=utf-8," + encodeURIComponent(jsonString);

      // Use chrome downloads API
      chrome.downloads.download(
        {
          url: dataUrl,
          filename: "recorded-actions.json",
          saveAs: true,
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error("Download error:", chrome.runtime.lastError);
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            console.log("Download started with ID:", downloadId);
            sendResponse({ success: true, downloadId: downloadId });
          }
        }
      );
    } catch (error) {
      console.error("Error creating download:", error);
      sendResponse({ error: error.message });
    }
    return true;
  } else if (message.type === "clearActions") {
    // Clear stored actions
    recordedActions = [];
    console.log("Cleared actions in background");
    sendResponse({ success: true });
    return true;
  }

  // If we get here, the message type wasn't handled
  sendResponse({ error: "Unknown message type" });
  return true;
});
