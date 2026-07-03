
import { useState, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import Modal from "@/components/ui/modal";
import organizationCSVImportService from "../services/organizationCSVImportService";
import {
  Upload,
  X,
  FileText,
  AlertCircle,
  CheckCircle,
  Download,
  Building2,
  Users,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

const OrganizationCSVImportModal = ({
  isOpen,
  onClose,
  onImportComplete,
  loading = false,
  supabase,
}) => {
  const [csvFile, setCsvFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState({});
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const [processingStage, setProcessingStage] = useState('');
  const { toast } = useToast();
  const fileInputRef = useRef(null);

  const validateForm = () => {
    const newErrors = {};

    if (!csvFile) {
      newErrors.file = "Please select a CSV file to upload";
      toast.error("Validation Error", "Please select a CSV file to upload");
    } else if (!csvFile.name.toLowerCase().endsWith(".csv")) {
      newErrors.file = "Please select a valid CSV file";
      toast.error("Validation Error", "Please select a valid CSV file");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setImporting(true);
    setImportResults(null);
    setProcessingStage('Processing CSV file...');

    try {
      // Process CSV file
      const csvData = await organizationCSVImportService.processCSVFile(csvFile);
      
      setProcessingStage(`Importing ${csvData.length} organizations...`);
      
      if (!supabase) {
        throw new Error('Authentication context not available. Please refresh the page.');
      }
      
      // Import data
      const result = await organizationCSVImportService.importOrganizationsFromCSV(
        supabase,
        csvData
      );

      console.log('Import service result:', result);
      console.log('Result data structure:', result?.data);

      // Validate and normalize the response structure
      const importData = result.data || {};
      console.log('Import data after normalization:', importData);
      
      const summary = importData.summary || {
        total_rows: 0,
        organizations_created: 0,
        organizations_updated: 0,
        errors_count: 0
      };
      
      console.log('Summary after normalization:', summary);
      
      const normalizedResult = {
        summary,
        created: importData.created || [],
        updated: importData.updated || [],
        errors: importData.errors || []
      };

      setImportResults(normalizedResult);
      
      if (summary.errors_count === 0) {
        toast.success(
          "Import Successful", 
          `Successfully processed ${summary.total_rows} organizations`
        );
      } else {
        toast.warning(
          "Import Completed with Errors", 
          `${summary.organizations_created + summary.organizations_updated} successful, ${summary.errors_count} errors`
        );
      }

      // Notify parent component to refresh data
      if (onImportComplete) {
        onImportComplete(result.data);
      }

    } catch (error) {
      console.error("CSV import error:", error);
      toast.error("Import Failed", error.message);
      
      // Create a proper error result structure
      const errorResult = {
        summary: { 
          total_rows: 0, 
          organizations_created: 0, 
          organizations_updated: 0, 
          errors_count: 1 
        },
        created: [],
        updated: [],
        errors: [{ 
          error: error.message || 'Unknown error occurred', 
          type: 'processing_error' 
        }]
      };
      
      setImportResults(errorResult);
    } finally {
      setImporting(false);
      setProcessingStage('');
    }
  };

  const handleClose = () => {
    setCsvFile(null);
    setDragActive(false);
    setErrors({});
    setImporting(false);
    setImportResults(null);
    setProcessingStage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast.error("File Error", "Please select a valid CSV file");
        setErrors((prev) => ({
          ...prev,
          file: "Please select a valid CSV file",
        }));
        return;
      }
      setCsvFile(file);
      if (errors.file) {
        setErrors((prev) => ({ ...prev, file: undefined }));
      }
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith(".csv")) {
        setCsvFile(file);
        if (errors.file) {
          setErrors((prev) => ({ ...prev, file: undefined }));
        }
      } else {
        toast.error("File Error", "Please drop a valid CSV file");
        setErrors((prev) => ({
          ...prev,
          file: "Please drop a valid CSV file",
        }));
      }
    }
  };

  const removeFile = () => {
    setCsvFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleDownloadTemplate = () => {
    organizationCSVImportService.downloadTemplate();
    toast.success("Template Downloaded", "CSV template has been downloaded to your computer");
  };

  const handleStartOver = () => {
    setCsvFile(null);
    setImportResults(null);
    setErrors({});
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Show results view after import
  if (importResults && !importing) {
    return (
      <Modal
        open={isOpen}
        onOpenChange={handleClose}
        title={
          <span className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> 
            Import Results
          </span>
        }
        description="Review the results of your organization import."
        className="max-w-4xl"
      >
        <div className="space-y-6 mt-6">
          {/* Safety check for importResults structure */}
          {!importResults || !importResults.summary ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <p className="text-red-800">Invalid import results structure. Please try again.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-blue-900">Total Rows</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {importResults.summary.total_rows}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-green-900">Created</p>
                  <p className="text-2xl font-bold text-green-700">
                    {importResults.summary.organizations_created}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-blue-900">Updated</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {importResults.summary.organizations_updated}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <div>
                  <p className="text-sm font-medium text-red-900">Errors</p>
                  <p className="text-2xl font-bold text-red-700">
                    {importResults.summary.errors_count}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Results Content */}
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {/* Created Organizations */}
            {importResults.created.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-medium text-green-900 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Created Organizations ({importResults.created.length})
                </h3>
                <div className="space-y-2">
                  {importResults.created.map((item, index) => (
                    <div key={index} className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-green-600" />
                          <div>
                            <p className="font-medium text-green-900">
                              {item.organization.partner_name}
                            </p>
                            <p className="text-sm text-green-700">
                              {item.organization.branch} • {item.organization.state}
                            </p>
                          </div>
                        </div>
                        <div className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
                          Partner ID: {item.partner_id}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Updated Organizations */}
            {importResults.updated.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-medium text-blue-900 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Updated Organizations ({importResults.updated.length})
                </h3>
                <div className="space-y-2">
                  {importResults.updated.map((item, index) => (
                    <div key={index} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-blue-600" />
                          <div>
                            <p className="font-medium text-blue-900">
                              {item.organization.partner_name}
                            </p>
                            <p className="text-sm text-blue-700">
                              {item.organization.branch} • {item.organization.state}
                            </p>
                          </div>
                        </div>
                        <div className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                          Partner ID: {item.partner_id}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors */}
            {importResults.errors.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-medium text-red-900 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Errors ({importResults.errors.length})
                </h3>
                <div className="space-y-2">
                  {importResults.errors.map((error, index) => (
                    <div key={index} className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-red-900">
                            {error.partner_id ? `Partner ID: ${error.partner_id}` : 'Processing Error'}
                          </p>
                          <p className="text-sm text-red-700">{error.error}</p>
                          <p className="text-xs text-red-600 mt-1">Type: {error.type}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </>
          )}

          {/* Actions */}
          <div className="flex justify-between pt-6 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleStartOver}
              className="text-gray-700"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Another File
            </Button>
            <Button
              onClick={handleClose}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Show main upload form
  return (
    <Modal
      open={isOpen}
      onOpenChange={!importing ? handleClose : undefined}
      title={
        <span className="flex items-center gap-2">
          <Building2 className="h-5 w-5" /> 
          Import Organizations from CSV
        </span>
      }
      description="Bulk import or update partner organizations from external system CSV files."
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6 mt-6">
        {/* Important Notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <p className="font-medium mb-2">Important Information:</p>
              <ul className="space-y-1 text-amber-700">
                <li>• This feature uses <strong>Partner ID synchronization</strong> to prevent duplicates</li>
                <li>• Existing organizations with matching Partner IDs will be <strong>updated</strong></li>
                <li>• New Partner IDs will create <strong>new organizations</strong> and admin users</li>
                <li>• Only <strong>super admin</strong> users can perform bulk imports</li>
                <li>• Maximum recommended: <strong>1000 rows</strong> per import</li>
              </ul>
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-900 border-b pb-2">
            Upload CSV File
          </h3>

          {/* Drag & Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive
                ? "border-brand-500 bg-brand-50"
                : errors.file
                ? "border-red-300 bg-red-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            {csvFile ? (
              <div className="space-y-3">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    File Ready for Import
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <FileText className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-600">
                      {csvFile.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({getFileSize(csvFile.size)})
                    </span>
                    {!importing && (
                      <button
                        type="button"
                        onClick={removeFile}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload className="h-12 w-12 text-gray-400 mx-auto" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Drop your organization CSV file here, or{" "}
                    <label className="text-brand-600 hover:text-brand-700 cursor-pointer">
                      browse
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleFileChange}
                        className="sr-only"
                        disabled={importing}
                      />
                    </label>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Only CSV files are supported (Max 5MB)
                  </p>
                </div>
              </div>
            )}
          </div>

          {errors.file && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {errors.file}
            </p>
          )}

          {/* Processing Status */}
          {importing && processingStage && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-sm text-blue-800">{processingStage}</span>
              </div>
            </div>
          )}

          {/* CSV Format Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-700 flex-1">
                <p className="font-medium mb-2">Required CSV Format:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <p className="font-medium text-blue-800 mb-1">Required Columns for Organizations:</p>
                    <ul className="space-y-0.5 text-blue-600">
                      <li>• <strong>Customer</strong> (Organization name)</li>
                      <li>• <strong>State</strong> (Required)</li>  
                      <li>• <strong>Branch</strong> (Required)</li>
                      <li>• <strong>Partner ID</strong> (Unique sync ID)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-blue-800 mb-1">Optional Organization Data:</p>
                    <ul className="space-y-0.5 text-blue-600">
                      <li>• <strong>Partner Address</strong></li>
                      <li>• <strong>Partner Contact Person</strong></li>
                      <li>• <strong>Partner Contact Phone</strong></li>
                      <li>• <strong>Partner Alternative Phone</strong></li>
                      <li>• <strong>Partner Email</strong></li>
                    </ul>
                  </div>
                </div>
                <p className="text-blue-600 mb-3">
                  <strong>Note:</strong> Other CSV columns (Sales Reference, Stove IDs, etc.) are included but only used for validation.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTemplate}
                  className="text-blue-600 hover:text-blue-800 border-blue-300 hover:border-blue-400"
                  disabled={importing}
                >
                  <Download className="h-3 w-3 mr-1" />
                  Download CSV Template
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex gap-3 pt-6 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            className="flex-1 text-gray-700"
            disabled={importing}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button 
            type="submit" 
            className="flex-1" 
            disabled={importing || loading}
          >
            {importing ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {processingStage || 'Processing...'}
              </div>
            ) : (
              <>
                <Building2 className="h-4 w-4 mr-2" />
                Import Organizations
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default OrganizationCSVImportModal;
