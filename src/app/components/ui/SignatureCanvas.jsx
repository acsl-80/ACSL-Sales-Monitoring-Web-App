
import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PenTool } from "lucide-react";
import {
  getSignatureFromCanvas,
  isCanvasEmpty,
  clearSignatureCanvas,
  loadSignatureToCanvas,
  initializeSignatureCanvas,
  getCanvasCoordinates,
  base64ToDataURL,
  extractBase64FromSignature,
} from "../../utils/signatureUtils";

const SignatureCanvas = ({
  signature,
  onSignatureChange,
  error,
  label = "Customer Signature *",
}) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPosition, setLastPosition] = useState({ x: 0, y: 0 });
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    initializeCanvas();
  }, []);

  useEffect(() => {
    // Load existing signature if provided (handles both base64 and data URL)
    // Wait for canvas to be ready before loading signature
    if (signature && canvasRef.current && canvasReady) {
      loadSignatureToCanvas(canvasRef.current, signature);
    }
  }, [signature, canvasReady]);

  const initializeCanvas = () => {
    setTimeout(() => {
      if (canvasRef.current) {
        initializeSignatureCanvas(canvasRef.current);
        setCanvasReady(true);
      }
    }, 100);
  };

  const startDrawing = (e) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Ensure consistent drawing settings
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const coords = getCanvasCoordinates(canvas, e);

    setLastPosition(coords);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const coords = getCanvasCoordinates(canvas, e);

    ctx.beginPath();
    ctx.moveTo(lastPosition.x, lastPosition.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    setLastPosition(coords);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // Convert canvas to base64 (API format) - consistent with Flutter approach
    const canvas = canvasRef.current;
    const base64Signature = getSignatureFromCanvas(canvas);

    // Always pass base64 format to parent (API format)
    // Parent components handle display conversion as needed
    onSignatureChange(base64Signature || "");
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    clearSignatureCanvas(canvas);
    // Send empty string in base64 format
    onSignatureChange("");
  };

  // Touch event handlers for mobile support
  const handleTouchStart = (e) => {
    e.preventDefault();
    startDrawing(e);
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    draw(e);
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    stopDrawing();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="border border-gray-300 rounded-lg p-4">
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            className="border border-gray-200 rounded cursor-crosshair touch-none"
            style={{
              width: "100%",
              height: "200px",
              maxWidth: "100%",
              display: "block",
            }}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
          <div className="mt-2 flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Draw the customer&apos;s signature above
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearSignature}
            >
              Clear Signature
            </Button>
          </div>
        </div>
        {/* {error && <p className="text-sm text-red-600">{error}</p>} */}
      </div>
    </div>
  );
};

export default SignatureCanvas;
