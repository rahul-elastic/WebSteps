window.__recording__ = false;
const actions = [];
// Make inputTimeouts a global variable
window.inputTimeouts = {};
// Store the field IDs or selectors that are currently being typed in
const activeInputs = new Set();

function isRecording() {
  return window.__recording__;
}

function getUniqueSelector(el) {
  // First try ID since it's most specific
  if (el.id) return `#${el.id}`;

  // If it has a name attribute, use tag and name
  if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;

  // If it has a class, use that with the tag name
  if (el.className && typeof el.className === "string" && el.className.trim()) {
    return `${el.tagName.toLowerCase()}.${el.className
      .trim()
      .replace(/\s+/g, ".")}`;
  }

  // Try to use parent's selector with nth-child
  try {
    if (el.parentNode) {
      const children = Array.from(el.parentNode.children);
      const index = children.indexOf(el);
      if (index !== -1) {
        return `${el.tagName.toLowerCase()}:nth-child(${index + 1})`;
      }
    }
  } catch (e) {
    console.error("Error getting nth-child selector:", e);
  }

  // Fall back to tag name
  return el.tagName.toLowerCase();
}

// Check if an action is a duplicate (same action, selector, and similar value)
function isDuplicateAction(newAction) {
  // Only check the most recent 10 actions to avoid performance issues
  const recentActions = actions.slice(-10);

  for (const action of recentActions) {
    if (
      action.action === newAction.action &&
      action.selector === newAction.selector
    ) {
      // For click actions, consider it a duplicate if selectors match
      if (action.action === "click") {
        return true;
      }

      // For input actions, check if values are very similar
      if (action.action === "input") {
        // Check if typing is sequential (adding characters)
        if (
          newAction.value.includes(action.value) ||
          action.value.includes(newAction.value)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

// Process only the meaningful click events
document.addEventListener("click", (e) => {
  if (!isRecording()) return;
  const el = e.target;

  // Create click action
  const newAction = {
    action: "click",
    selector: getUniqueSelector(el),
    text: el.innerText ? el.innerText.trim() : null,
  };

  // Don't record duplicate clicks on the same element
  if (isDuplicateAction(newAction)) {
    console.log("Skipping duplicate click action");
    return;
  }

  // Record the action
  actions.push(newAction);
  console.log("Recorded click action:", newAction);
});

// Focus handler to prepare for input
document.addEventListener(
  "focus",
  (e) => {
    if (!isRecording()) return;
    const el = e.target;

    if (["input", "textarea", "select"].includes(el.tagName.toLowerCase())) {
      const selector = getUniqueSelector(el);
      activeInputs.add(selector);

      // Store the initial value to compare later
      if (!window.inputTimeouts[selector]) {
        window.inputTimeouts[selector] = {
          initialValue: el.value,
          timeout: null,
          actionIndex: -1,
        };
      }
    }
  },
  true
);

// Blur handler to finalize input
document.addEventListener(
  "blur",
  (e) => {
    if (!isRecording()) return;
    const el = e.target;

    if (["input", "textarea", "select"].includes(el.tagName.toLowerCase())) {
      const selector = getUniqueSelector(el);

      // If we have this input in our tracking
      if (window.inputTimeouts[selector]) {
        // Clear any existing timeout
        if (window.inputTimeouts[selector].timeout) {
          clearTimeout(window.inputTimeouts[selector].timeout);
        }

        // If value changed from initial, record it
        if (el.value !== window.inputTimeouts[selector].initialValue) {
          // Remove any previous action for this input
          if (window.inputTimeouts[selector].actionIndex >= 0) {
            actions.splice(window.inputTimeouts[selector].actionIndex, 1);
          }

          // Add new action with final value
          const newAction = {
            action: "input",
            selector: selector,
            value: el.value,
          };

          actions.push(newAction);
          console.log("Finalized input action on blur:", newAction);
        }

        // Clean up
        activeInputs.delete(selector);
        delete window.inputTimeouts[selector];
      }
    }
  },
  true
);

// Enhanced debounced input handler
document.addEventListener("input", (e) => {
  if (!isRecording()) return;
  const el = e.target;

  if (["input", "textarea"].includes(el.tagName.toLowerCase())) {
    const selector = getUniqueSelector(el);

    // Track this input
    activeInputs.add(selector);

    // Clear any existing timeout
    if (
      window.inputTimeouts[selector] &&
      window.inputTimeouts[selector].timeout
    ) {
      clearTimeout(window.inputTimeouts[selector].timeout);
    }

    // Initialize tracking for this element if it doesn't exist
    if (!window.inputTimeouts[selector]) {
      window.inputTimeouts[selector] = {
        initialValue: el.value,
        timeout: null,
        actionIndex: -1,
      };
    }

    // Remove any existing action for this element
    if (window.inputTimeouts[selector].actionIndex >= 0) {
      actions.splice(window.inputTimeouts[selector].actionIndex, 1);
    }

    // Create a new action (but don't add it yet)
    const newAction = {
      action: "input",
      selector: selector,
      value: el.value,
    };

    // Only add actions that change the value significantly
    if (el.value !== window.inputTimeouts[selector].initialValue) {
      // Add and track new action
      actions.push(newAction);
      window.inputTimeouts[selector].actionIndex = actions.length - 1;

      // Set timeout to confirm this action after 1 second of inactivity
      window.inputTimeouts[selector].timeout = setTimeout(() => {
        console.log("Confirmed input action after timeout:", newAction);
        // Keep the action and clear the timeout tracking
        window.inputTimeouts[selector].timeout = null;
      }, 1000);
    }
  }
});

// Handle form submissions to capture final values
document.addEventListener("submit", (e) => {
  if (!isRecording()) return;

  // Finalize all active inputs before form submission
  activeInputs.forEach((selector) => {
    if (
      window.inputTimeouts[selector] &&
      window.inputTimeouts[selector].timeout
    ) {
      clearTimeout(window.inputTimeouts[selector].timeout);
      console.log("Cleared timeout for", selector, "due to form submission");
      window.inputTimeouts[selector].timeout = null;
    }
  });

  // Clear active inputs
  activeInputs.clear();
});

// Clean up when recording stops
function stopRecording() {
  // Finalize all active inputs
  activeInputs.forEach((selector) => {
    if (
      window.inputTimeouts[selector] &&
      window.inputTimeouts[selector].timeout
    ) {
      clearTimeout(window.inputTimeouts[selector].timeout);
      window.inputTimeouts[selector].timeout = null;
    }
  });

  // Clear active inputs
  activeInputs.clear();
}

window.getRecordedActions = () => {
  // Ensure all active inputs are finalized
  activeInputs.forEach((selector) => {
    if (
      window.inputTimeouts[selector] &&
      window.inputTimeouts[selector].timeout
    ) {
      clearTimeout(window.inputTimeouts[selector].timeout);
      window.inputTimeouts[selector].timeout = null;
    }
  });

  console.log("getRecordedActions called, returning:", actions);

  // Clean up duplicates or sequential inputs before returning
  const cleanedActions = [];
  let lastInputSelector = null;

  for (const action of actions) {
    // Skip sequential inputs on the same field (keep only the last one)
    if (action.action === "input") {
      if (lastInputSelector === action.selector) {
        // Replace the last added input action
        cleanedActions.pop();
      }
      lastInputSelector = action.selector;
    } else {
      // For non-input actions, reset the tracker
      lastInputSelector = null;
    }

    cleanedActions.push(action);
  }

  return cleanedActions;
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getRecordedActions") {
    console.log("Message received to get recorded actions");
    sendResponse({ actions: window.getRecordedActions() });
  }

  // Handle recording state changes
  if (message.type === "setRecordingState" && message.state === false) {
    stopRecording();
  }

  return true;
});

// Log when content script is loaded
console.log(
  "WebSteps content script loaded. Recording state:",
  window.__recording__
);
