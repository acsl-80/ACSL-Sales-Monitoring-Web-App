/**
 * Signature Utilities
 * Handles signature canvas operations and data conversion
 * Base64 is the primary format for all API communication
 * UI handles display conversion automatically
 */

/**
 * Converts signature canvas to base64 string (primary format for API)
 * @param {HTMLCanvasElement} canvas - The signature canvas element
 * @returns {string|null} Base64 encoded signature data or null if empty
 */
export const getSignatureFromCanvas = (canvas) => {
  if (!canvas) return null;

  // Check if canvas has any content (not empty)
  if (isCanvasEmpty(canvas)) {
    return null;
  }

  // Convert canvas to base64 PNG data (API format)
  const dataURL = canvas.toDataURL("image/png");

  // Extract just the base64 part (remove "data:image/png;base64," prefix)
  // This is the format the API expects and stores
  const base64Data = dataURL.split(",")[1];

  return base64Data;
};

/**
 * Checks if the signature canvas is empty
 * @param {HTMLCanvasElement} canvas - The signature canvas element
 * @returns {boolean} True if canvas is empty, false otherwise
 */
export const isCanvasEmpty = (canvas) => {
  if (!canvas) return true;

  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Check if all pixels are transparent (alpha channel = 0) or white
  for (let i = 3; i < imageData.data.length; i += 4) {
    if (imageData.data[i] !== 0) {
      return false; // Found a non-transparent pixel
    }
  }

  return true;
};

/**
 * Validates signature data (checks if valid base64 or data URL)
 * @param {string} signatureData - Base64 signature data or data URL
 * @returns {boolean} True if signature is valid, false otherwise
 */
export const isValidSignature = (signatureData) => {
  if (!signatureData || signatureData.trim().length === 0) {
    return false;
  }

  // Handle both base64 and data URL formats
  if (signatureData.startsWith("data:image/")) {
    return signatureData.length > 22; // More than just the prefix
  }

  // For base64, check if it's a reasonable length
  return signatureData.length > 100; // Base64 signature should be substantial
};

/**
 * Converts base64 signature to data URL for display purposes
 * @param {string} base64Data - Base64 encoded signature data from API
 * @returns {string} Data URL that can be used as image src
 */
export const base64ToDataURL = (base64Data) => {
  if (!base64Data) return "";

  // If it's already a data URL, return as is
  if (base64Data.startsWith("data:")) {
    return base64Data;
  }

  // Convert base64 to data URL for display
  return `data:image/png;base64,${base64Data}`;
};

/**
 * Converts data URL or base64 back to pure base64 for API
 * @param {string} signatureData - Signature data (base64 or data URL)
 * @returns {string} Pure base64 string for API
 */
export const extractBase64FromSignature = (signatureData) => {
  if (!signatureData) return "";

  // If it's a data URL, extract the base64 part
  if (signatureData.startsWith("data:image/")) {
    return signatureData.split(",")[1] || "";
  }

  // If it's already base64, return as is
  return signatureData;
};

/**
 * Clears the signature canvas
 * @param {HTMLCanvasElement} canvas - The signature canvas element
 */
export const clearSignatureCanvas = (canvas) => {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Reinitialize with white background
  initializeSignatureCanvas(canvas);
};

/**
 * Loads signature data into canvas (handles both base64 and data URL)
 * @param {HTMLCanvasElement} canvas - The signature canvas element
 * @param {string} signatureData - Base64 or data URL signature data
 */
export const loadSignatureToCanvas = (canvas, signatureData) => {
  if (!canvas || !signatureData) return;

  const ctx = canvas.getContext("2d");
  const img = new window.Image();

  img.onload = () => {
    // Clear canvas and redraw with signature
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set white background first
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // If the image is very small or has different dimensions, scale appropriately
    let scaleX = canvas.width / img.width;
    let scaleY = canvas.height / img.height;

    // Use the smaller scale to maintain aspect ratio, but don't scale up too much
    let scale = Math.min(scaleX, scaleY);

    // Don't scale up if the image is already reasonably sized
    if (scale > 1 && (img.width > 200 || img.height > 100)) {
      scale = 1;
    }

    // Calculate centered position
    const scaledWidth = img.width * scale;
    const scaledHeight = img.height * scale;
    const x = (canvas.width - scaledWidth) / 2;
    const y = (canvas.height - scaledHeight) / 2;

    // Draw the signature with proper scaling and positioning
    ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

    // Reset drawing settings for future edits (with thicker line for visibility)
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  };

  img.onerror = () => {
    console.warn("Failed to load signature image");
  };

  // Convert to data URL if it's just base64
  const dataURL = base64ToDataURL(signatureData);
  img.src = dataURL;
};

/**
 * Initializes signature canvas with proper settings
 * @param {HTMLCanvasElement} canvas - The signature canvas element
 */
export const initializeSignatureCanvas = (canvas) => {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  // Clear any existing content
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Set drawing properties for crisp lines
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3; // Slightly thicker for better visibility
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Enable smooth lines
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Set a white background to ensure proper PNG export
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Reset fill color for future drawings
  ctx.fillStyle = "#000000";
};

/**
 * Gets canvas coordinates from mouse/touch event
 * @param {HTMLCanvasElement} canvas - The signature canvas element
 * @param {Event} event - Mouse or touch event
 * @returns {Object} Coordinates {x, y}
 */
export const getCanvasCoordinates = (canvas, event) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  let clientX, clientY;

  if (event.touches && event.touches.length > 0) {
    // Touch event
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else {
    // Mouse event
    clientX = event.clientX;
    clientY = event.clientY;
  }

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
};
