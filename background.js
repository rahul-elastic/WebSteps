// Background service worker to handle communication
chrome.runtime.onInstalled.addListener(() => {
  console.log("WebSteps extension installed successfully");
});

// Store recorded actions in the background for persistence
let recordedActions = [];
// Store recording state
let isRecording = false;

// Listen for messages from popup.js or content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message.type, message);

  if (message.type === "getRecordingState") {
    // Return the current recording state
    sendResponse({ isRecording: isRecording });
    return true;
  }

  if (message.type === "setRecordingState") {
    // Update the recording state
    isRecording = message.isRecording;
    console.log("Updated recording state to:", isRecording);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "getRecordedActions") {
    // If we already have actions stored, return them
    if (recordedActions && recordedActions.length > 0) {
      sendResponse({ actions: recordedActions });
      return true;
    }

    // Otherwise, forward message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: "getRecordedActions" },
          (response) => {
            if (response && response.actions) {
              recordedActions = response.actions;
            }
            sendResponse(response);
          }
        );
      } else {
        sendResponse({ error: "No active tab found" });
      }
    });
    return true; // Required to use sendResponse asynchronously
  }

  if (message.type === "storeActions") {
    // Store actions in background memory
    recordedActions = message.actions;
    console.log("Stored actions in background:", recordedActions);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "downloadActions") {
    // Use the stored actions to initiate download
    console.log("Initiating download from background script", recordedActions);

    // Check if we have actions to download
    if (!recordedActions || recordedActions.length === 0) {
      console.error("No actions to download");
      sendResponse({ error: "No actions to download" });
      return true;
    }

    try {
      // Convert JSON to a data URI instead of using Blob and URL.createObjectURL
      const jsonString = JSON.stringify(recordedActions, null, 2);
      const dataStr =
        "data:application/json;charset=utf-8," + encodeURIComponent(jsonString);

      // Use chrome downloads API with the data URI
      chrome.downloads.download(
        {
          url: dataStr,
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
  }

  if (message.type === "clearActions") {
    // Clear stored actions
    recordedActions = [];
    console.log("Cleared actions in background");
    sendResponse({ success: true });
    return true;
  }
});
