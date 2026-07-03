
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, FileText, Loader2 } from "lucide-react";

const ImageUploadSection = ({
  label,
  preview,
  uploading = false,
  onUpload,
  placeholder,
  error,
  uploadIcon: UploadIcon = Upload,
  accept = "image/*",
  buttonText = "Upload Image",
}) => {
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && onUpload) {
      onUpload(file);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        {preview ? (
          <div className="space-y-4">
            {(() => {
              const isPdf =
                typeof preview === "string" &&
                (preview.startsWith("data:application/pdf") ||
                  /\.pdf(\?|$)/i.test(preview));
              if (isPdf) {
                return (
                  <div className="flex flex-col items-center gap-2 text-gray-600">
                    <FileText className="h-12 w-12" />
                    <a
                      href={preview}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-blue-600 underline"
                    >
                      View uploaded document
                    </a>
                  </div>
                );
              }
              return (
                <img
                  src={preview}
                  alt="Preview"
                  className="max-w-xs mx-auto rounded-lg"
                  style={{ maxHeight: "200px", objectFit: "contain" }}
                />
              );
            })()}
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Change
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <UploadIcon className="h-12 w-12 text-gray-400 mx-auto" />
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {buttonText}
              </Button>
              {placeholder && (
                <p className="text-sm text-gray-500 mt-2">{placeholder}</p>
              )}
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
};

export default ImageUploadSection;
