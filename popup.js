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

// Add project management functions
async function fetchProjects() {
  try {
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwiaWF0IjoxNzQ1OTg0NzQ1LCJleHAiOjE3NDYwNzExNDV9.mYN9R0aP1x-Lr2jxNawaXFOPeVosqPX0NInjf94H25I";

    console.log("Making projects request...");
    const response = await fetch("http://localhost:7001/api/projects", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: "chrome-extension://",
      },
      credentials: "include",
    });

    console.log("Projects response status:", response.status);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Raw API response:", data);

    if (!Array.isArray(data)) {
      console.error("Projects response is not an array:", data);
      throw new Error("Invalid projects data format - expected array");
    }

    // Map the projects to the format expected by the extension
    const mappedProjects = data.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description || "",
      testcases: {
        total: project.total_testcases || 0,
        passing: project.passing_testcases || 0,
        failing: project.failing_testcases || 0,
        notRun: project.not_run_testcases || 0,
      },
      lastRunDate: project.last_run_date,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    }));

    console.log("Mapped projects for extension:", mappedProjects);
    return mappedProjects;
  } catch (error) {
    console.error("Error in fetchProjects:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function populateProjectDropdown() {
  const projectSelect = document.getElementById("projectName");
  const projectError = document.getElementById("projectError");

  try {
    // Show loading state
    projectSelect.innerHTML = '<option value="">Loading projects...</option>';
    projectSelect.disabled = true;
    projectError.style.display = "none";

    const projects = await fetchProjects();
    console.log("Projects to populate:", projects);

    // Clear and enable the select
    projectSelect.innerHTML = "";
    projectSelect.disabled = false;

    // Add default option
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Select a project";
    projectSelect.appendChild(defaultOption);

    if (!projects || projects.length === 0) {
      throw new Error("No projects found. Please create a project first.");
    }

    // Add projects from API
    projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.name} (${project.testcases.total} tests)`;
      projectSelect.appendChild(option);
    });

    projectError.style.display = "none";
    return projects;
  } catch (error) {
    console.error("Error in populateProjectDropdown:", error);
    projectSelect.innerHTML =
      '<option value="">Failed to load projects</option>';
    projectSelect.disabled = true;
    projectError.textContent = error.message || "Failed to load projects";
    projectError.style.display = "block";
    throw error;
  }
}

// Update showTestCaseForm to populate projects
async function showTestCaseForm() {
  const form = document.getElementById("testCaseForm");

  try {
    // Check if there are any recorded actions
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getRecordedActions" }, resolve);
    });

    if (!response || !response.actions || response.actions.length === 0) {
      updateStatusText(
        "No actions recorded. Please record some actions first."
      );
      return;
    }

    console.log("Showing form with recorded actions:", response.actions);

    // Show the form before populating projects
    form.style.display = "block";

    try {
      // Populate projects dropdown
      await populateProjectDropdown();
      document.getElementById("testCaseName").focus();
    } catch (error) {
      console.error("Error populating projects:", error);
      const projectError = document.getElementById("projectError");
      projectError.textContent = "Failed to load projects. Please try again.";
      projectError.style.display = "block";
    }
  } catch (error) {
    console.error("Error showing form:", error);
    updateStatusText("Error: " + error.message);
  }
}

function hideTestCaseForm() {
  const form = document.getElementById("testCaseForm");
  form.style.display = "none";

  // Clear all input fields
  document.getElementById("testCaseName").value = "";
  document.getElementById("projectName").value = "";
  document.getElementById("description").value = "";
}

function displayEnglishSteps(englishSteps) {
  const englishStepsDiv = document.getElementById("englishSteps");
  const englishStepsList = document.getElementById("englishStepsList");

  // Clear previous steps
  englishStepsList.innerHTML = "";

  // Add new steps
  englishSteps.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    englishStepsList.appendChild(li);
  });

  // Show the steps section
  englishStepsDiv.style.display = "block";
}

// Add token management functions at the top
async function getAuthToken() {
  // Get token from local storage first

  // If no token in storage, use hardcoded token
  const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwiaWF0IjoxNzQ1OTgyNTk4LCJleHAiOjE3NDYwNjg5OTh9.erlIC-o6HttfCKo3qHDw0HH3syf0CQUcrmA9AhaiKtE";

  return token;
}

async function saveTestCaseToFlytest(formData) {
  try {
    const token = await getAuthToken();

    // Get the recorded actions from background
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getRecordedActions" }, resolve);
    });

    console.log(
      "Response from getRecordedActions:",
      JSON.stringify(response, null, 2)
    );

    if (!response || !response.actions || !Array.isArray(response.actions)) {
      console.error("Invalid actions format:", response);
      throw new Error("No actions recorded or invalid format");
    }

    if (response.actions.length === 0) {
      throw new Error("No actions recorded");
    }

    const actions = response.actions.map((action) => ({
      action: action.action,
      selector: action.selector,
      text: action.text,
      value: action.value,
    }));

    console.log("Processed actions:", JSON.stringify(actions, null, 2));

    // Get current tab info
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      throw new Error("No active tab found");
    }

    // First generate English steps using OpenAI
    const requestData = {
      actions: actions,
      projectId: formData.projectId,
      url: tab.url,
    };

    console.log(
      "Sending request to generate steps:",
      JSON.stringify(requestData, null, 2)
    );

    // Call the OpenAI API to generate English steps
    const apiResponse = await fetch(
      "http://localhost:7001/api/generate-test-steps",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Origin: "chrome-extension://",
        },
        body: JSON.stringify(requestData),
      }
    );

    const responseText = await apiResponse.text();
    console.log("Raw API Response:", responseText);

    if (!apiResponse.ok) {
      console.error("API Error Response:", {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        body: responseText,
      });

      if (apiResponse.status === 401) {
        await chrome.storage.local.remove(["authToken"]);
        throw new Error(
          "Authentication failed. Please try again with a valid token."
        );
      }

      throw new Error(
        `Failed to generate test steps: ${apiResponse.status} ${
          apiResponse.statusText
        }${responseText ? ` - ${responseText}` : ""}`
      );
    }

    const responseData = JSON.parse(responseText);
    console.log("Parsed API Response:", responseData);

    if (
      !responseData.englishSteps ||
      !Array.isArray(responseData.englishSteps)
    ) {
      console.error("Invalid API response format:", responseData);
      throw new Error("Invalid response format from API");
    }

    const englishSteps = responseData.englishSteps;

    // Display the English steps
    displayEnglishSteps(englishSteps);

    // Create test case in FlyTest
    console.log("Creating test case with data:", {
      name: formData.testCaseName,
      description: formData.description,
      projectId: formData.projectId,
      steps: englishSteps,
      executed_code: actions,
    });

    // Create the test case under the selected project
    const testCaseResponse = await fetch(
      `http://localhost:7001/api/testcases/project/${formData.projectId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Origin: "chrome-extension://",
        },
        body: JSON.stringify({
          name: formData.testCaseName,
          description: formData.description,
          steps: englishSteps.join("\n"), // Join steps into a string with newlines
          executed_code: JSON.stringify(actions), // Store original actions as executed_code
          status: "active",
        }),
      }
    );

    if (!testCaseResponse.ok) {
      const errorText = await testCaseResponse.text();
      console.error("Test Case API Error:", {
        status: testCaseResponse.status,
        statusText: testCaseResponse.statusText,
        body: errorText,
      });

      if (testCaseResponse.status === 401) {
        await chrome.storage.local.remove(["authToken"]);
        throw new Error(
          "Authentication failed. Please try again with a valid token."
        );
      }

      throw new Error(
        `Failed to create test case: ${testCaseResponse.status} ${
          testCaseResponse.statusText
        }${errorText ? ` - ${errorText}` : ""}`
      );
    }

    const testCaseData = await testCaseResponse.json();
    console.log("Test case created:", testCaseData);

    // Store in chrome.storage.local
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(["testCases"], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const testCases = result.testCases || [];
        const localTestCaseData = {
          ...formData,
          recordedActions: actions,
          steps: englishSteps,
          recordedAt: new Date().toISOString(),
          url: tab.url,
          status: "completed",
          flytestId: testCaseData.id,
        };
        testCases.push(localTestCaseData);

        chrome.storage.local.set({ testCases }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(testCaseData);
          }
        });
      });
    });
  } catch (error) {
    console.error("Error saving test case:", error);
    throw error;
  }
}

// Add function to get pending test cases
function getPendingTestCases() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["testCases"], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        const testCases = result.testCases || [];
        resolve(testCases);
      }
    });
  });
}

// Add function to clear test cases after successful API sync
function clearSyncedTestCases() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ testCases: [] }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// Update the form submission handler
document.addEventListener("DOMContentLoaded", () => {
  syncStateWithBackground();

  const saveButton = document.getElementById("saveTestCase");

  saveButton.addEventListener("click", async (e) => {
    e.preventDefault();

    const projectSelect = document.getElementById("projectName");
    const projectError = document.getElementById("projectError");

    if (!projectSelect.value) {
      projectError.textContent = "Please select a project";
      projectError.style.display = "block";
      return;
    }

    const formData = {
      testCaseName: document.getElementById("testCaseName").value,
      projectId: projectSelect.value, // Use selected project ID
      description: document.getElementById("description").value,
    };

    try {
      updateStatusText("Saving test case...");
      await saveTestCaseToFlytest(formData);
      updateStatusText("Test case saved successfully!");
      hideTestCaseForm();
    } catch (error) {
      console.error("Error saving test case:", error);
      updateStatusText("Error saving test case: " + error.message);
    }
  });

  // Add cancel button handler
  document.getElementById("cancelForm").addEventListener("click", () => {
    hideTestCaseForm();
    updateStatusText("Test case creation cancelled");
  });
});

// Update the toggle button handler
document.getElementById("toggle").addEventListener("click", async () => {
  try {
    // Disable the button while processing
    const toggleButton = document.getElementById("toggle");
    toggleButton.disabled = true;

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      console.error("No active tab found");
      updateStatusText("Error: No active tab found");
      toggleButton.disabled = false;
      return;
    }

    // First inject the content script if not already injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.log("Content script injection error:", error);
      try {
        await chrome.tabs.reload(tab.id);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (reloadError) {
        console.error(
          "Failed to reload and inject content script:",
          reloadError
        );
        throw new Error("Please refresh the page and try again");
      }
    }

    // Toggle recording state
    isRecording = !isRecording;
    updateButtonState();
    updateStatusText(
      isRecording ? "Starting recording..." : "Stopping recording..."
    );

    // Update content script and background states
    await Promise.all([
      new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          { type: "setRecordingState", isRecording },
          resolve
        );
      }),
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "setRecordingState", isRecording },
          resolve
        );
      }),
    ]);

    // If stopping recording, handle the recorded actions
    if (!isRecording) {
      await clearPendingInputs(tab.id);
      try {
        await storeActionsInBackground(tab.id);
        console.log("Actions stored, showing form...");
        await showTestCaseForm();
      } catch (error) {
        console.error("Error handling recorded actions:", error);
        updateStatusText("Error: " + error.message);
      }
    } else {
      hideTestCaseForm();
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
    updateStatusText("Error: " + error.message);
    isRecording = !isRecording; // Revert state on error
    updateButtonState();
  } finally {
    toggleButton.disabled = false;
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
      updateStatusText("Stopping recording...");

      // Notify background of state change
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "setRecordingState",
            isRecording: false,
          },
          resolve
        );
      });

      // Update content script
      await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "setRecordingState",
            isRecording: false,
          },
          resolve
        );
      });

      // Clear any pending input timeouts
      await clearPendingInputs(tab.id);

      // Store the actions
      await storeActionsInBackground(tab.id);
    }

    // Get the actions from background
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getRecordedActions" }, resolve);
    });

    if (!response || !response.actions || response.actions.length === 0) {
      throw new Error("No actions to download");
    }

    // Trigger the download
    chrome.runtime.sendMessage({ type: "downloadActions" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Download error:", chrome.runtime.lastError);
        updateStatusText("Error: " + chrome.runtime.lastError.message);
        alert("Error downloading actions: " + chrome.runtime.lastError.message);
      } else if (response && response.error) {
        console.error("Download error:", response.error);
        updateStatusText("Error: " + response.error);
        alert("Error downloading actions: " + response.error);
      } else {
        console.log("Download success:", response);
        updateStatusText("Download completed");
      }

      // Re-enable the button
      downloadButton.disabled = false;
      downloadButton.innerText = "Download Actions";
    });
  } catch (error) {
    console.error("Error downloading actions:", error);
    updateStatusText("Error: " + error.message);
    alert("Error downloading actions: " + error.message);

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

    // If currently recording, stop recording first
    if (isRecording) {
      isRecording = false;
      updateButtonState();
      updateStatusText("Stopping recording...");

      // Notify background of state change
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "setRecordingState",
            isRecording: false,
          },
          resolve
        );
      });

      // Update content script
      await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "setRecordingState",
            isRecording: false,
          },
          resolve
        );
      });

      // Clear any pending input timeouts
      await clearPendingInputs(tab.id);

      // Store the actions
      await storeActionsInBackground(tab.id);
    }

    // Get the actions from background
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getRecordedActions" }, resolve);
    });

    if (!response || !response.actions || response.actions.length === 0) {
      throw new Error("No actions to copy");
    }

    // Convert actions to readable text
    const text = actionsToReadableText(response.actions);

    // Copy to clipboard
    await navigator.clipboard.writeText(text);
    updateStatusText("Steps copied to clipboard");
    alert("Readable steps copied to clipboard!");
  } catch (error) {
    console.error("Error copying text:", error);
    updateStatusText("Error: " + error.message);
    alert("Error copying text: " + error.message);
  }
});
