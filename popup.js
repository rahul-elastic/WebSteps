let isRecording = false;

function syncStateWithBackground() {
  chrome.runtime.sendMessage({ type: "getRecordingState" }, (response) => {
    if (response && response.isRecording !== undefined) {
      isRecording = response.isRecording;
      updateButtonState();
      updateStatusText();
    }
  });
}

function updateButtonState() {
  const toggleButton = document.getElementById("toggle");
  toggleButton.innerText = isRecording ? "Stop Recording" : "Start Recording";
  toggleButton.classList.toggle("recording", isRecording);
}

function updateStatusText(message) {
  const statusElement = document.getElementById("status");
  if (message) {
    statusElement.innerText = message;
    return;
  }

  if (isRecording) {
    statusElement.innerText = "Recording in progress...";
  } else {
    statusElement.innerText = "Ready to record";
  }
}

function actionsToReadableText(actions) {
  if (!actions || actions.length === 0) {
    return "No actions recorded yet.";
  }

  let stepNumber = 1;

  return actions
    .map((action) => {
      let stepText = "";

      if (action.action === "click") {
        // Format click actions based on the element type and available text
        if (action.selector.startsWith("button")) {
          stepText = `Click the "${action.text || action.selector}" button`;
        } else if (action.selector.startsWith("a")) {
          stepText = `Click the "${action.text || action.selector}" link`;
        } else if (
          action.selector.startsWith('input[type="checkbox"]') ||
          action.selector.startsWith('input[type="radio"]')
        ) {
          stepText = `Select the "${action.text || action.selector}" checkbox`;
        } else if (action.selector.includes("select")) {
          stepText = `Click on the "${
            action.text || action.selector
          }" dropdown`;
        } else {
          stepText = `Click on ${
            action.text ? `"${action.text}"` : action.selector
          }`;
        }
      } else if (action.action === "input") {
        // Clean up sensitive values if needed
        let displayValue = action.value;

        // Handle password fields differently
        if (
          action.selector.includes("password") ||
          action.selector.includes("#password")
        ) {
          displayValue = "********";
          stepText = `Enter your password in the ${action.selector} field`;
        } else {
          // For other inputs, show the value
          stepText = `Enter "${displayValue}" into the ${getReadableFieldName(
            action.selector
          )} field`;
        }
      } else {
        stepText = `Perform ${action.action} on ${action.selector}`;
      }

      return `${stepNumber++}. ${stepText}`;
    })
    .join("\n");
}

// Helper function to get a human-readable field name from a selector
function getReadableFieldName(selector) {
  // Extract a more readable name from selectors

  // For ID selectors like #firstName, return "First Name"
  if (selector.startsWith("#")) {
    const idName = selector.substring(1);
    // Convert camelCase to separate words and capitalize first letter
    return idName
      .replace(/([A-Z])/g, " $1") // Add space before capital letters
      .replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
      .replace(/([a-z])(\d)/g, "$1 $2"); // Add space between letters and numbers
  }

  // For name attributes like input[name="email"]
  if (selector.includes("name=")) {
    const match = selector.match(/name="([^"]+)"/);
    if (match && match[1]) {
      return match[1]
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/([a-z])(\d)/g, "$1 $2")
        .replace(/_/g, " ");
    }
  }

  // Return the original selector as fallback
  return selector;
}

function clearPendingInputs(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        func: () => {
          // Clear any pending input timeouts
          if (window.inputTimeouts) {
            Object.keys(window.inputTimeouts).forEach((key) => {
              clearTimeout(window.inputTimeouts[key].timeout);
              delete window.inputTimeouts[key];
            });
          }
          return true;
        },
      },
      () => resolve()
    );
  });
}

function storeActionsInBackground(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        func: () => {
          console.log("Getting recorded actions for background storage");
          return window.getRecordedActions ? window.getRecordedActions() : null;
        },
      },
      (results) => {
        if (!results || !results[0] || results[0].result === null) {
          console.error("No actions to store");
          reject("No actions to store");
          return;
        }

        const actions = results[0].result;
        // Store actions in background script for persistence
        chrome.runtime.sendMessage(
          { type: "storeActions", actions: actions },
          (response) => {
            console.log("Actions stored in background", response);
            resolve(actions);
          }
        );
      }
    );
  });
}

document.addEventListener("DOMContentLoaded", () => {
  syncStateWithBackground();
});

document.getElementById("toggle").addEventListener("click", async () => {
  try {
    // Toggle recording state
    isRecording = !isRecording;
    updateButtonState();
    updateStatusText();

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      console.error("No active tab found");
      updateStatusText("Error: No active tab found");
      return;
    }

    // Notify background of state change
    chrome.runtime.sendMessage({
      type: "setRecordingState",
      isRecording: isRecording,
    });

    // If stopping recording, clear any pending input timeouts and store actions
    if (!isRecording) {
      updateStatusText("Finalizing recording...");
      await clearPendingInputs(tab.id);

      // Try to store actions in background
      try {
        await storeActionsInBackground(tab.id);
        updateStatusText("Recording saved");
      } catch (error) {
        console.error("Error storing actions:", error);
        updateStatusText("Error: No actions recorded");
      }
    }

    // Update recording state in the content script
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (status) => {
        console.log("Setting recording status to:", status);
        window.__recording__ = status;

        // If stopping recording, ensure inputTimeouts is defined as a global
        if (!status && typeof window.inputTimeouts === "undefined") {
          window.inputTimeouts = {};
        }
      },
      args: [isRecording],
    });
  } catch (error) {
    console.error("Error toggling recording:", error);
    updateStatusText("Error toggling recording");
  }
});

document.getElementById("download").addEventListener("click", async () => {
  try {
    // Disable the button to prevent multiple clicks
    const downloadButton = document.getElementById("download");
    downloadButton.disabled = true;
    downloadButton.innerText = "Downloading...";
    updateStatusText("Preparing download...");

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      console.error("No active tab found");
      downloadButton.disabled = false;
      downloadButton.innerText = "Download Actions";
      updateStatusText("Error: No active tab found");
      return;
    }

    // If currently recording, stop recording first
    if (isRecording) {
      isRecording = false;
      updateButtonState();

      // Notify background of state change
      chrome.runtime.sendMessage({
        type: "setRecordingState",
        isRecording: false,
      });

      // Update content script
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.__recording__ = false;
        },
      });
    }

    // Clear any pending input timeouts
    await clearPendingInputs(tab.id);

    // First store the actions in the background
    try {
      await storeActionsInBackground(tab.id);

      // Then tell the background to download them
      chrome.runtime.sendMessage({ type: "downloadActions" }, (response) => {
        console.log("Download response:", response);

        if (response && response.error) {
          alert("Download error: " + response.error);
          updateStatusText("Download failed: " + response.error);
        } else {
          updateStatusText("Download initiated");
        }

        // Re-enable the button
        downloadButton.disabled = false;
        downloadButton.innerText = "Download Actions";
      });
    } catch (error) {
      console.error("Error preparing download:", error);
      alert(
        "No actions were recorded. Make sure to click 'Start Recording' before performing actions on the page."
      );
      updateStatusText("No actions to download");

      // Re-enable the button
      downloadButton.disabled = false;
      downloadButton.innerText = "Download Actions";
    }
  } catch (error) {
    console.error("Error downloading actions:", error);
    alert("Error downloading actions: " + error.message);
    updateStatusText("Download error: " + error.message);

    // Re-enable the button
    const downloadButton = document.getElementById("download");
    downloadButton.disabled = false;
    downloadButton.innerText = "Download Actions";
  }
});

document.getElementById("copy-text").addEventListener("click", async () => {
  try {
    updateStatusText("Copying steps to clipboard...");

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      console.error("No active tab found");
      updateStatusText("Error: No active tab found");
      return;
    }

    // Clear any pending input timeouts before copying
    await clearPendingInputs(tab.id);

    // Get stored actions from background
    chrome.runtime.sendMessage({ type: "getRecordedActions" }, (response) => {
      if (response && response.actions && response.actions.length > 0) {
        const text = actionsToReadableText(response.actions);
        navigator.clipboard.writeText(text).then(() => {
          alert("Readable steps copied to clipboard!");
          updateStatusText("Steps copied to clipboard");
        });
      } else {
        // Try to get actions from content script
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            func: () => {
              console.log("Getting recorded actions for text copy");
              return window.getRecordedActions
                ? window.getRecordedActions()
                : null;
            },
          },
          (results) => {
            if (
              !results ||
              !results[0] ||
              results[0].result === null ||
              results[0].result === undefined ||
              !results[0].result.length
            ) {
              console.error(
                "No recorded actions found for text copy:",
                results
              );
              alert(
                "No actions were recorded. Make sure to click 'Start Recording' before performing actions on the page."
              );
              updateStatusText("No actions to copy");
              return;
            }

            const actions = results[0].result;
            const text = actionsToReadableText(actions);
            navigator.clipboard.writeText(text).then(() => {
              alert("Readable steps copied to clipboard!");
              updateStatusText("Steps copied to clipboard");
            });
          }
        );
      }
    });
  } catch (error) {
    console.error("Error copying text:", error);
    alert("Error copying text: " + error.message);
    updateStatusText("Error copying: " + error.message);
  }
});
