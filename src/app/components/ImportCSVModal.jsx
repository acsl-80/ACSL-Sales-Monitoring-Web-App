
import { useState, useMemo, useRef, useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Modal from "@/components/ui/modal";
import {
  Upload,
  X,
  FileText,
  Search,
  Building2,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

const ImportCSVModal = ({
  isOpen,
  onClose,
  onImport,
  organizations = [],
  loading = false,
  preselectedOrganizationId = null,
}) => {
  const [selectedOrganization, setSelectedOrganization] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [csvFile, setCsvFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState({});
  const { toast } = useToast();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Handle preselected organization
  useEffect(() => {
    if (preselectedOrganizationId && isOpen) {
      const preselectedOrg = organizations.find(
        (org) => org.id === preselectedOrganizationId
      );
      if (preselectedOrg) {
        setSelectedOrganization(preselectedOrganizationId);
        setSearchTerm(preselectedOrg.partner_name);
        setDropdownOpen(false);
      }
    } else if (!preselectedOrganizationId) {
      // Reset to empty if no preselection
      setSelectedOrganization("");
      setSearchTerm("");
    }
  }, [preselectedOrganizationId, isOpen, organizations]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Filter organizations based on search term
  const filteredOrganizations = useMemo(() => {
    if (!searchTerm) return organizations;
    return organizations.filter(
      (org) =>
        org.partner_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (org.email &&
          org.email.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [organizations, searchTerm]);

  const validateForm = () => {
    const newErrors = {};

    if (!selectedOrganization) {
      newErrors.organization = "Please select a partner organization";
      toast.error("Validation Error", "Please select a partner organization");
    }

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

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const selectedOrg = organizations.find(
      (org) => org.id === selectedOrganization
    );
    onImport({
      organizationId: selectedOrganization,
      organizationName: selectedOrg?.partner_name,
      csvFile: csvFile,
    });
  };

  const handleClose = () => {
    setSelectedOrganization("");
    setSearchTerm("");
    setCsvFile(null);
    setDragActive(false);
    setDropdownOpen(false);
    setErrors({});
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
  };

  const getFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={handleClose}
      title={
        <span className="flex items-center gap-2">
          <Upload className="h-5 w-5" /> Import CSV Sales Data
        </span>
      }
      description="Select a partner and upload their sales data via CSV file."
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6 mt-6">
        {/* Partner Selection */}
        <div className="space-y-4">
          <div className="border-b"></div>
          {/* Searchable Partner Selection */}
          <div className="space-y-2">
            <Label htmlFor="organization" className="text-gray-700">
              Select Partner/Organization{" "}
              <span className="text-red-500">*</span>
            </Label>
            <div className="relative" ref={dropdownRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
                <Input
                  value={searchTerm}
                  onFocus={() =>
                    !preselectedOrganizationId && setDropdownOpen(true)
                  }
                  onChange={(e) => {
                    if (preselectedOrganizationId) return; // Prevent changes when preselected

                    setSearchTerm(e.target.value);
                    setDropdownOpen(true);
                    // Clear selection when searching
                    if (selectedOrganization && e.target.value) {
                      const selectedOrg = organizations.find(
                        (org) => org.id === selectedOrganization
                      );
                      if (
                        selectedOrg &&
                        !selectedOrg.partner_name
                          .toLowerCase()
                          .includes(e.target.value.toLowerCase()) &&
                        !(
                          selectedOrg.email &&
                          selectedOrg.email
                            .toLowerCase()
                            .includes(e.target.value.toLowerCase())
                        )
                      ) {
                        setSelectedOrganization("");
                      }
                    }
                    if (errors.organization) {
                      setErrors((prev) => ({
                        ...prev,
                        organization: undefined,
                      }));
                    }
                  }}
                  placeholder={
                    preselectedOrganizationId
                      ? "Organization pre-selected"
                      : "Search and select a partner organization..."
                  }
                  className={`text-sm text-gray-600 pl-10 pr-4 ${
                    errors.organization ? "border-red-500" : ""
                  } ${
                    preselectedOrganizationId
                      ? "bg-gray-50 cursor-not-allowed"
                      : ""
                  }`}
                  disabled={preselectedOrganizationId}
                  readOnly={preselectedOrganizationId}
                />
                {searchTerm && !preselectedOrganizationId && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm("");
                      setSelectedOrganization("");
                      setDropdownOpen(false);
                    }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 z-10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Dropdown Results */}
              {dropdownOpen &&
                (searchTerm || !selectedOrganization) &&
                !preselectedOrganizationId && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                    {filteredOrganizations.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500 text-center">
                        {searchTerm
                          ? "No partners match your search"
                          : "No partners available"}
                      </div>
                    ) : (
                      <div className="py-1">
                        {filteredOrganizations.map((org) => (
                          <button
                            key={org.id}
                            type="button"
                            onClick={() => {
                              setSelectedOrganization(org.id);
                              setSearchTerm(org.partner_name);
                              setDropdownOpen(false);
                              if (errors.organization) {
                                setErrors((prev) => ({
                                  ...prev,
                                  organization: undefined,
                                }));
                              }
                            }}
                            className={`w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${
                              selectedOrganization === org.id
                                ? "bg-blue-50 text-blue-700"
                                : ""
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-gray-900 truncate">
                                  {org.partner_name}
                                </div>
                                <div className="text-xs text-gray-500 truncate">
                                  {org.email || "No email"}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {org.branch}, {org.state}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              {/* Selected Organization Display */}
              {selectedOrganization && !dropdownOpen && (
                <div
                  className={`mt-2 p-3 rounded-md ${
                    preselectedOrganizationId
                      ? "bg-green-50 border border-green-200"
                      : "bg-blue-50 border border-blue-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2
                        className={`h-4 w-4 ${
                          preselectedOrganizationId
                            ? "text-green-600"
                            : "text-blue-600"
                        }`}
                      />
                      <div>
                        <div
                          className={`font-medium ${
                            preselectedOrganizationId
                              ? "text-green-900"
                              : "text-blue-900"
                          }`}
                        >
                          {
                            organizations.find(
                              (org) => org.id === selectedOrganization
                            )?.partner_name
                          }
                          {preselectedOrganizationId && (
                            <span className="ml-2 text-xs font-normal text-green-700">
                              (Pre-selected)
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-xs ${
                            preselectedOrganizationId
                              ? "text-green-700"
                              : "text-blue-700"
                          }`}
                        >
                          {organizations.find(
                            (org) => org.id === selectedOrganization
                          )?.email || "No email"}
                        </div>
                      </div>
                    </div>
                    {!preselectedOrganizationId && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOrganization("");
                          setSearchTerm("");
                        }}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            {errors.organization && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.organization}
              </p>
            )}
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
                    File Ready
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <FileText className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-600">
                      {csvFile.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({getFileSize(csvFile.size)})
                    </span>
                    <button
                      type="button"
                      onClick={removeFile}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload className="h-12 w-12 text-gray-400 mx-auto" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Drop your CSV file here, or{" "}
                    <label className="text-brand-600 hover:text-brand-700 cursor-pointer">
                      browse
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileChange}
                        className="sr-only"
                      />
                    </label>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Only CSV files are supported
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

          {/* CSV Format Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-700 flex-1">
                <p className="font-medium mb-1">CSV Format Requirements:</p>
                <ul className="space-y-0.5 text-blue-600 mb-2">
                  <li>• Include headers in the first row</li>
                  <li>
                    • Required columns (in order): Sales Reference, Sales Date,
                    Customer, State, Branch, Quantity, Downloaded by, Stove IDs
                  </li>
                  <li>
                    • <b>Stove IDs</b> column should contain comma-separated
                    stove IDs (e.g. 101052766, 101052811, ...)
                  </li>
                  <li>• Date format: MM/DD/YYYY or YYYY-MM-DD</li>
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    // Download new CSV template
                    const headers = [
                      "Sales Reference",
                      "Sales Date",
                      "Customer",
                      "State",
                      "Branch",
                      "Quantity",
                      "Downloaded by",
                      "Stove IDs",
                    ];
                    const sampleData = [
                      'TR-F89E19,7/29/2025,LAPO MFB,Oyo,BODIJA 2,10,ACSL Admin,"101052766, 101052811, 101052813, 101052840, 101052767, 101052794, 101052800, 101052775, 101052765, 101052850"',
                    ];
                    const csvContent = [headers.join(","), ...sampleData].join(
                      "\n"
                    );
                    const blob = new Blob([csvContent], { type: "text/csv" });
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "sales_import_template.csv";
                    link.click();
                    window.URL.revokeObjectURL(url);
                  }}
                  className="text-blue-600 hover:text-blue-800 underline text-xs font-medium"
                >
                  Download CSV Template
                </button>
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
            disabled={loading}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Importing...
              </div>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import CSV
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default ImportCSVModal;
