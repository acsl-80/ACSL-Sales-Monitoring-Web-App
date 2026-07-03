
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Search,
  Filter,
  X,
  Download,
  Calendar,
  MapPin,
  User,
  Banknote,
  Settings,
  FileDown,
  RotateCcw,
  Save,
} from "lucide-react";
import { lgaAndStates } from "../constants";

const SalesAdvancedFilter = ({
  isOpen,
  onClose,
  onFilter,
  onExport,
  loading,
  salesData,
}) => {
  const [filters, setFilters] = useState({
    // Date filters
    dateFrom: "",
    dateTo: "",
    createdFrom: "",
    createdTo: "",
    salesDateFrom: "",
    salesDateTo: "",

    // Quick date filters
    lastNDays: "",
    thisWeek: false,
    thisMonth: false,
    thisYear: false,
    lastWeek: false,
    lastMonth: false,
    lastYear: false,

    // Location filters
    state: "",
    states: [],
    city: "",
    cities: [],
    lga: "",
    lgas: [],
    country: "",

    // Product/Stove filters
    stoveSerialNo: "",
    stoveSerialNos: [],
    stoveSerialNoPattern: "",

    // People filters
    contactPerson: "",
    contactPhone: "",
    endUserName: "",
    aka: "",
    partnerName: "",
    createdBy: "",
    createdByIds: [],

    // Amount filters
    amountMin: "",
    amountMax: "",
    amountExact: "",

    // Status filters
    status: "",
    statuses: [],

    // Phone filters
    phone: "",
    otherPhone: "",
    anyPhone: "",

    // Search filters
    search: "",
    searchIn: "",
    searchMode: "contains",

    // Geographic filters
    region: "",
    zone: "",
    area: "",
    territory: "",
    branch: "",
    district: "",
    ward: "",

    // Order/Sort filters
    orderBy: "",
    orderDirection: "asc",

    // Pagination
    page: 1,
    limit: 50,

    // Additional filters
    hasLocation: null,
    hasContact: null,
    hasAmount: null,
    hasStatus: null,
    isActive: null,
    isDeleted: false,

    // Custom date ranges
    customDateField: "",
    customDateFrom: "",
    customDateTo: "",

    // Advanced search
    advancedSearch: "",
    exactMatch: false,
    caseSensitive: false,

    // Export options
    exportFormat: "csv",
    exportFields: [],
    includeHeaders: true,

    // Performance filters
    skipCache: false,
    realTime: false,
  });

  const [activeFilters, setActiveFilters] = useState([]);
  const [savedFilters, setSavedFilters] = useState([]);
  const [filterName, setFilterName] = useState("");

  // Available states and LGAs from constants
  const states = Object.keys(lgaAndStates);
  const getLgasForState = (state) => lgaAndStates[state] || [];

  const handleFilterChange = (key, value) => {
    setFilters((prev) => {
      const newFilters = { ...prev, [key]: value };

      // Clear LGA when state changes
      if (key === "state") {
        newFilters.lga = "";
        newFilters.lgas = [];
      }

      return newFilters;
    });
  };

  const handleArrayFilterAdd = (key, value) => {
    if (value && !filters[key].includes(value)) {
      setFilters((prev) => ({
        ...prev,
        [key]: [...prev[key], value],
      }));
    }
  };

  const handleArrayFilterRemove = (key, value) => {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].filter((item) => item !== value),
    }));
  };

  const applyFilters = () => {
    // Remove empty filters
    const cleanFilters = Object.entries(filters).reduce((acc, [key, value]) => {
      if (
        value !== "" &&
        value !== null &&
        value !== undefined &&
        (Array.isArray(value) ? value.length > 0 : true)
      ) {
        acc[key] = value;
      }
      return acc;
    }, {});

    onFilter(cleanFilters);
    updateActiveFilters(cleanFilters);
  };

  const clearFilters = () => {
    setFilters({
      dateFrom: "",
      dateTo: "",
      createdFrom: "",
      createdTo: "",
      salesDateFrom: "",
      salesDateTo: "",
      lastNDays: "",
      thisWeek: false,
      thisMonth: false,
      thisYear: false,
      lastWeek: false,
      lastMonth: false,
      lastYear: false,
      state: "",
      states: [],
      city: "",
      cities: [],
      lga: "",
      lgas: [],
      country: "",
      stoveSerialNo: "",
      stoveSerialNos: [],
      stoveSerialNoPattern: "",
      contactPerson: "",
      contactPhone: "",
      endUserName: "",
      aka: "",
      partnerName: "",
      createdBy: "",
      createdByIds: [],
      amountMin: "",
      amountMax: "",
      amountExact: "",
      status: "",
      statuses: [],
      phone: "",
      otherPhone: "",
      anyPhone: "",
      search: "",
      searchIn: "",
      searchMode: "contains",
      region: "",
      zone: "",
      area: "",
      territory: "",
      branch: "",
      district: "",
      ward: "",
      orderBy: "",
      orderDirection: "asc",
      page: 1,
      limit: 50,
      hasLocation: null,
      hasContact: null,
      hasAmount: null,
      hasStatus: null,
      isActive: null,
      isDeleted: false,
      customDateField: "",
      customDateFrom: "",
      customDateTo: "",
      advancedSearch: "",
      exactMatch: false,
      caseSensitive: false,
      exportFormat: "csv",
      exportFields: [],
      includeHeaders: true,
      skipCache: false,
      realTime: false,
    });
    setActiveFilters([]);
    onFilter({});
  };

  const updateActiveFilters = (appliedFilters) => {
    const active = Object.entries(appliedFilters).map(([key, value]) => {
      let displayValue = value;
      if (Array.isArray(value)) {
        displayValue = value.join(", ");
      } else if (typeof value === "boolean") {
        displayValue = value ? "Yes" : "No";
      }

      return {
        key,
        label: formatFilterLabel(key),
        value: displayValue,
      };
    });
    setActiveFilters(active);
  };

  const formatFilterLabel = (key) => {
    const labels = {
      dateFrom: "Date From",
      dateTo: "Date To",
      createdFrom: "Created From",
      createdTo: "Created To",
      salesDateFrom: "Sales Date From",
      salesDateTo: "Sales Date To",
      lastNDays: "Last N Days",
      state: "State",
      states: "States",
      city: "City",
      cities: "Cities",
      lga: "LGA",
      lgas: "LGAs",
      country: "Country",
      stoveSerialNo: "Stove Serial No",
      stoveSerialNos: "Stove Serial Nos",
      contactPerson: "Contact Person",
      contactPhone: "Contact Phone",
      endUserName: "End User Name",
      partnerName: "Partner Name",
      createdBy: "Created By",
      amountMin: "Amount Min",
      amountMax: "Amount Max",
      amountExact: "Amount Exact",
      status: "Status",
      phone: "Phone",
      search: "Search",
      searchIn: "Search In",
      searchMode: "Search Mode",
      exactMatch: "Exact Match",
      caseSensitive: "Case Sensitive",
      orderBy: "Sort By",
      orderDirection: "Sort Order",
      exportFormat: "Export Format",
      // Quick date filters
      thisWeek: "This Week",
      thisMonth: "This Month",
      thisYear: "This Year",
      lastWeek: "Last Week",
      lastMonth: "Last Month",
      lastYear: "Last Year",
      // Data validation
      hasLocation: "Has Location",
      hasContact: "Has Contact",
      hasAmount: "Has Amount",
      hasStatus: "Has Status",
      isActive: "Is Active",
      // Performance options
      skipCache: "Skip Cache",
      realTime: "Real Time",
      includeHeaders: "Include Headers",
    };
    return labels[key] || key.charAt(0).toUpperCase() + key.slice(1);
  };

  const saveFilter = () => {
    if (filterName.trim()) {
      const newFilter = {
        name: filterName,
        filters: { ...filters },
        savedAt: new Date().toISOString(),
      };
      setSavedFilters((prev) => [...prev, newFilter]);
      setFilterName("");
      // In real app, save to localStorage or API
      localStorage.setItem(
        "savedFilters",
        JSON.stringify([...savedFilters, newFilter])
      );
    }
  };

  const loadFilter = (savedFilter) => {
    setFilters(savedFilter.filters);
  };

  useEffect(() => {
    // Load saved filters from localStorage
    const saved = localStorage.getItem("savedFilters");
    if (saved) {
      setSavedFilters(JSON.parse(saved));
    }
  }, []);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full bg-white shadow-2xl transform transition-all duration-300 ease-in-out z-50 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } ${
          isOpen
            ? "w-full sm:w-[90vw] md:w-[600px] lg:w-[700px] xl:w-[800px]"
            : "w-0"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 bg-gradient-to-r from-brand-50 to-brand-100">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold text-brand-900">
                Advanced Sales Filter
              </h2>
              <p className="text-sm text-brand-700 mt-1">
                Filter and search through sales data with precision
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="flex-shrink-0 h-8 w-8 text-brand-600 hover:text-brand-900 hover:bg-brand-100"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
              {/* Header Actions */}
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
                <Button
                  onClick={applyFilters}
                  disabled={loading}
                  className="bg-brand-800 hover:bg-brand-900 text-xs sm:text-sm"
                  size="sm"
                >
                  <Filter className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                  Apply Filter
                </Button>
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="text-xs sm:text-sm text-gray-800 hover:bg-gray-400 "
                  size="sm"
                >
                  <X className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                  Clear All
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onExport && onExport()}
                  className="text-xs sm:text-sm text-gray-800 hover:bg-gray-400"
                  size="sm"
                >
                  <Download className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                  Export
                </Button>
              </div>

              {/* Active Filters */}
              {activeFilters.length > 0 && (
                <Card className="bg-brand-50 border-brand-200">
                  <CardHeader className="pb-2 sm:pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm sm:text-base md:text-lg text-brand-900">
                        Active Filters ({activeFilters.length})
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearFilters}
                        className="text-xs text-brand-700 hover:text-brand-900 hover:bg-brand-100"
                      >
                        Clear All
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1 sm:gap-2">
                      {activeFilters.map((filter, index) => (
                        <Badge
                          key={index}
                          variant="default"
                          className="text-xs sm:text-sm px-2 py-1 sm:px-3 bg-brand-800 text-white hover:bg-brand-900 cursor-pointer transition-all duration-200 group"
                          onClick={() => {
                            // Remove this specific filter
                            const newFilters = { ...filters };
                            if (Array.isArray(newFilters[filter.key])) {
                              newFilters[filter.key] = [];
                            } else if (
                              typeof newFilters[filter.key] === "boolean"
                            ) {
                              newFilters[filter.key] = false;
                            } else {
                              newFilters[filter.key] = "";
                            }
                            setFilters(newFilters);
                            onFilter(newFilters);
                          }}
                        >
                          {filter.label}: {filter.value}
                          <X className="w-3 h-3 ml-1.5 group-hover:scale-110 transition-transform" />
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Main Filter Form */}
              <Accordion
                type="multiple"
                defaultValue={["search", "date"]}
                className="w-full"
              >
                {/* Search Section */}
                <AccordionItem value="search">
                  <AccordionTrigger className="text-sm sm:text-base md:text-lg font-semibold">
                    <div className="flex items-center gap-2 text-gray-800">
                      <Search className="w-4 h-4 sm:w-5 sm:h-5" />
                      Search & Basic Filters
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Card>
                      <CardContent className="pt-4 sm:pt-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                          <div className="space-y-2">
                            <Label
                              htmlFor="search"
                              className="text-xs sm:text-sm"
                            >
                              General Search
                            </Label>
                            <Input
                              id="search"
                              placeholder="Search across all fields..."
                              value={filters.search}
                              onChange={(e) =>
                                handleFilterChange("search", e.target.value)
                              }
                              className="text-xs sm:text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs sm:text-sm font-medium">
                              Search In
                            </Label>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {[
                                { value: "", label: "All Fields", icon: "🌐" },
                                {
                                  value: "endUserName",
                                  label: "Customer",
                                  icon: "👤",
                                },
                                {
                                  value: "contactPerson",
                                  label: "Contact",
                                  icon: "📞",
                                },
                                {
                                  value: "stoveSerialNo",
                                  label: "Serial No.",
                                  icon: "🏷️",
                                },
                                { value: "state", label: "State", icon: "📍" },
                                { value: "phone", label: "Phone", icon: "📱" },
                              ].map((field) => (
                                <Badge
                                  key={field.value}
                                  variant={
                                    filters.searchIn === field.value
                                      ? "default"
                                      : "outline"
                                  }
                                  className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs px-2 py-1 ${
                                    filters.searchIn === field.value
                                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                      : "border-gray-300 text-gray-700 hover:border-emerald-500 hover:text-emerald-600"
                                  }`}
                                  onClick={() =>
                                    handleFilterChange("searchIn", field.value)
                                  }
                                >
                                  <span className="mr-1">{field.icon}</span>
                                  {field.label}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2 sm:col-span-2">
                            <Label className="text-xs sm:text-sm font-medium">
                              Search Mode
                            </Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {[
                                {
                                  value: "contains",
                                  label: "Contains",
                                  icon: "🔍",
                                },
                                {
                                  value: "exact",
                                  label: "Exact Match",
                                  icon: "🎯",
                                },
                                {
                                  value: "startsWith",
                                  label: "Starts With",
                                  icon: "▶️",
                                },
                                {
                                  value: "endsWith",
                                  label: "Ends With",
                                  icon: "◀️",
                                },
                              ].map((mode) => (
                                <Badge
                                  key={mode.value}
                                  variant={
                                    filters.searchMode === mode.value
                                      ? "default"
                                      : "outline"
                                  }
                                  className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                    filters.searchMode === mode.value
                                      ? "bg-teal-600 text-white hover:bg-teal-700"
                                      : "border-gray-300 text-gray-700 hover:border-teal-500 hover:text-teal-600"
                                  }`}
                                  onClick={() =>
                                    handleFilterChange("searchMode", mode.value)
                                  }
                                >
                                  <span className="mr-1.5">{mode.icon}</span>
                                  {mode.label}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2 sm:col-span-2">
                            <Label className="text-xs sm:text-sm font-medium">
                              Sort By
                            </Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {[
                                { value: "date", label: "Date", icon: "📅" },
                                {
                                  value: "amount",
                                  label: "Amount",
                                  icon: "💰",
                                },
                                {
                                  value: "contactPerson",
                                  label: "Contact Person",
                                  icon: "👤",
                                },
                                { value: "state", label: "State", icon: "📍" },
                                {
                                  value: "status",
                                  label: "Status",
                                  icon: "📊",
                                },
                              ].map((sortOption) => (
                                <Badge
                                  key={sortOption.value}
                                  variant={
                                    filters.orderBy === sortOption.value
                                      ? "default"
                                      : "outline"
                                  }
                                  className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                    filters.orderBy === sortOption.value
                                      ? "bg-cyan-600 text-white hover:bg-cyan-700"
                                      : "border-gray-300 text-gray-700 hover:border-cyan-500 hover:text-cyan-600"
                                  }`}
                                  onClick={() =>
                                    handleFilterChange(
                                      "orderBy",
                                      sortOption.value
                                    )
                                  }
                                >
                                  <span className="mr-1.5">
                                    {sortOption.icon}
                                  </span>
                                  {sortOption.label}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 sm:mt-4">
                          <Label className="text-sm font-medium mb-3 block">
                            Search Options
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              variant={
                                filters.exactMatch ? "default" : "outline"
                              }
                              className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                filters.exactMatch
                                  ? "bg-purple-600 text-white hover:bg-purple-700"
                                  : "border-gray-300 text-gray-700 hover:border-purple-500 hover:text-purple-600"
                              }`}
                              onClick={() =>
                                handleFilterChange(
                                  "exactMatch",
                                  !filters.exactMatch
                                )
                              }
                            >
                              <span className="mr-1.5">🎯</span>
                              Exact Match
                              {filters.exactMatch && (
                                <X className="w-3 h-3 ml-1.5" />
                              )}
                            </Badge>

                            <Badge
                              variant={
                                filters.caseSensitive ? "default" : "outline"
                              }
                              className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                filters.caseSensitive
                                  ? "bg-pink-600 text-white hover:bg-pink-700"
                                  : "border-gray-300 text-gray-700 hover:border-pink-500 hover:text-pink-600"
                              }`}
                              onClick={() =>
                                handleFilterChange(
                                  "caseSensitive",
                                  !filters.caseSensitive
                                )
                              }
                            >
                              <span className="mr-1.5">🔤</span>
                              Case Sensitive
                              {filters.caseSensitive && (
                                <X className="w-3 h-3 ml-1.5" />
                              )}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                {/* Date Filters */}
                <AccordionItem value="date">
                  <AccordionTrigger className="text-sm sm:text-base md:text-lg font-semibold">
                    <div className="flex items-center gap-2 text-gray-800">
                      <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
                      Date Filters
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Card>
                      <CardContent className="pt-4 sm:pt-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                          <div className="space-y-2">
                            <Label
                              htmlFor="dateFrom"
                              className="text-xs sm:text-sm"
                            >
                              Date From
                            </Label>
                            <DatePicker
                              value={filters.dateFrom}
                              onChange={(value) =>
                                handleFilterChange("dateFrom", value)
                              }
                              placeholder="Select start date"
                              className="text-xs sm:text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor="dateTo"
                              className="text-xs sm:text-sm"
                            >
                              Date To
                            </Label>
                            <DatePicker
                              value={filters.dateTo}
                              onChange={(value) =>
                                handleFilterChange("dateTo", value)
                              }
                              placeholder="Select end date"
                              className="text-xs sm:text-sm"
                            />
                          </div>

                          <div className="space-y-2 sm:col-span-2">
                            <Label
                              htmlFor="lastNDays"
                              className="text-xs sm:text-sm"
                            >
                              Last N Days
                            </Label>
                            <Input
                              id="lastNDays"
                              type="number"
                              placeholder="e.g., 30"
                              value={filters.lastNDays}
                              onChange={(e) =>
                                handleFilterChange("lastNDays", e.target.value)
                              }
                              className="text-xs sm:text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="createdFrom">Created From</Label>
                            <DatePicker
                              value={filters.createdFrom}
                              onChange={(value) =>
                                handleFilterChange("createdFrom", value)
                              }
                              placeholder="Created start date"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="createdTo">Created To</Label>
                            <DatePicker
                              value={filters.createdTo}
                              onChange={(value) =>
                                handleFilterChange("createdTo", value)
                              }
                              placeholder="Created end date"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="salesDateFrom">
                              Sales Date From
                            </Label>
                            <DatePicker
                              value={filters.salesDateFrom}
                              onChange={(value) =>
                                handleFilterChange("salesDateFrom", value)
                              }
                              placeholder="Sales start date"
                            />
                          </div>
                        </div>

                        {/* Quick Date Filters */}
                        <div className="mt-6">
                          <Label className="text-base font-medium mb-3 block">
                            Quick Date Filters
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { key: "thisWeek", label: "This Week" },
                              { key: "thisMonth", label: "This Month" },
                              { key: "thisYear", label: "This Year" },
                              { key: "lastWeek", label: "Last Week" },
                              { key: "lastMonth", label: "Last Month" },
                              { key: "lastYear", label: "Last Year" },
                            ].map((item) => (
                              <Badge
                                key={item.key}
                                variant={
                                  filters[item.key] ? "default" : "outline"
                                }
                                className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                  filters[item.key]
                                    ? "bg-brand-800 text-white hover:bg-brand-900"
                                    : "border-gray-300 text-gray-700 hover:border-brand-600 hover:text-brand-700"
                                }`}
                                onClick={() =>
                                  handleFilterChange(
                                    item.key,
                                    !filters[item.key]
                                  )
                                }
                              >
                                {item.label}
                                {filters[item.key] && (
                                  <X className="w-3 h-3 ml-1.5" />
                                )}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                {/* Location Filters */}
                <AccordionItem value="location">
                  <AccordionTrigger className="text-lg font-semibold">
                    <div className="flex items-center gap-2 text-gray-800">
                      <MapPin className="w-5 h-5" />
                      Location Filters
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="country">Country</Label>
                            <Input
                              id="country"
                              placeholder="Enter country"
                              value={filters.country}
                              onChange={(e) =>
                                handleFilterChange("country", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="state">State</Label>
                            <Select
                              value={filters.state}
                              onValueChange={(value) =>
                                handleFilterChange("state", value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select state" />
                              </SelectTrigger>
                              <SelectContent>
                                {states.map((state) => (
                                  <SelectItem key={state} value={state}>
                                    {state}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="lga">LGA</Label>
                            <Select
                              value={filters.lga}
                              onValueChange={(value) =>
                                handleFilterChange("lga", value)
                              }
                              disabled={!filters.state}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select LGA" />
                              </SelectTrigger>
                              <SelectContent>
                                {getLgasForState(filters.state).map((lga) => (
                                  <SelectItem key={lga} value={lga}>
                                    {lga}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="city">City</Label>
                            <Input
                              id="city"
                              placeholder="Enter city"
                              value={filters.city}
                              onChange={(e) =>
                                handleFilterChange("city", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="region">Region</Label>
                            <Input
                              id="region"
                              placeholder="Enter region"
                              value={filters.region}
                              onChange={(e) =>
                                handleFilterChange("region", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="zone">Zone</Label>
                            <Input
                              id="zone"
                              placeholder="Enter zone"
                              value={filters.zone}
                              onChange={(e) =>
                                handleFilterChange("zone", e.target.value)
                              }
                            />
                          </div>
                        </div>

                        {/* Multiple Selection Areas */}
                        <div className="mt-6 space-y-4">
                          <div>
                            <Label className="text-base font-medium">
                              Multiple States
                            </Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {filters.states.map((state) => (
                                <Badge
                                  key={state}
                                  variant="secondary"
                                  className="text-sm"
                                >
                                  {state}
                                  <button
                                    onClick={() =>
                                      handleArrayFilterRemove("states", state)
                                    }
                                    className="ml-2 text-red-500 hover:text-red-700"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                            <Select
                              onValueChange={(value) =>
                                handleArrayFilterAdd("states", value)
                              }
                            >
                              <SelectTrigger className="mt-2">
                                <SelectValue placeholder="Add states" />
                              </SelectTrigger>
                              <SelectContent>
                                {states
                                  .filter(
                                    (state) => !filters.states.includes(state)
                                  )
                                  .map((state) => (
                                    <SelectItem key={state} value={state}>
                                      {state}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                {/* People & Contact Filters */}
                <AccordionItem value="people">
                  <AccordionTrigger className="text-lg font-semibold">
                    <div className="flex items-center gap-2 text-gray-800">
                      <User className="w-5 h-5" />
                      People & Contact Filters
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="contactPerson">
                              Contact Person
                            </Label>
                            <Input
                              id="contactPerson"
                              placeholder="Enter contact person name"
                              value={filters.contactPerson}
                              onChange={(e) =>
                                handleFilterChange(
                                  "contactPerson",
                                  e.target.value
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="contactPhone">Contact Phone</Label>
                            <Input
                              id="contactPhone"
                              placeholder="Enter contact phone"
                              value={filters.contactPhone}
                              onChange={(e) =>
                                handleFilterChange(
                                  "contactPhone",
                                  e.target.value
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="endUserName">End User Name</Label>
                            <Input
                              id="endUserName"
                              placeholder="Enter end user name"
                              value={filters.endUserName}
                              onChange={(e) =>
                                handleFilterChange(
                                  "endUserName",
                                  e.target.value
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="aka">AKA (Also Known As)</Label>
                            <Input
                              id="aka"
                              placeholder="Enter alternative name"
                              value={filters.aka}
                              onChange={(e) =>
                                handleFilterChange("aka", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="partnerName">Partner Name</Label>
                            <Input
                              id="partnerName"
                              placeholder="Enter partner name"
                              value={filters.partnerName}
                              onChange={(e) =>
                                handleFilterChange(
                                  "partnerName",
                                  e.target.value
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="createdBy">Created By</Label>
                            <Input
                              id="createdBy"
                              placeholder="Enter creator name"
                              value={filters.createdBy}
                              onChange={(e) =>
                                handleFilterChange("createdBy", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="phone">Phone</Label>
                            <Input
                              id="phone"
                              placeholder="Enter phone number"
                              value={filters.phone}
                              onChange={(e) =>
                                handleFilterChange("phone", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="otherPhone">Other Phone</Label>
                            <Input
                              id="otherPhone"
                              placeholder="Enter other phone"
                              value={filters.otherPhone}
                              onChange={(e) =>
                                handleFilterChange("otherPhone", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="anyPhone">Any Phone</Label>
                            <Input
                              id="anyPhone"
                              placeholder="Search any phone field"
                              value={filters.anyPhone}
                              onChange={(e) =>
                                handleFilterChange("anyPhone", e.target.value)
                              }
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                {/* Amount & Status Filters */}
                <AccordionItem value="amount">
                  <AccordionTrigger className="text-lg font-semibold">
                    <div className="flex items-center gap-2 text-gray-800">
                      <Banknote className="w-5 h-5" />
                      Amount & Status Filters
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="amountMin">Minimum Amount</Label>
                            <Input
                              id="amountMin"
                              type="number"
                              placeholder="Enter minimum amount"
                              value={filters.amountMin}
                              onChange={(e) =>
                                handleFilterChange("amountMin", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="amountMax">Maximum Amount</Label>
                            <Input
                              id="amountMax"
                              type="number"
                              placeholder="Enter maximum amount"
                              value={filters.amountMax}
                              onChange={(e) =>
                                handleFilterChange("amountMax", e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="amountExact">Exact Amount</Label>
                            <Input
                              id="amountExact"
                              type="number"
                              placeholder="Enter exact amount"
                              value={filters.amountExact}
                              onChange={(e) =>
                                handleFilterChange(
                                  "amountExact",
                                  e.target.value
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2 md:col-span-3">
                            <Label className="text-base font-medium">
                              Status
                            </Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {[
                                {
                                  value: "pending",
                                  label: "Pending",
                                  color:
                                    "bg-yellow-100 text-yellow-800 border-yellow-300",
                                },
                                {
                                  value: "completed",
                                  label: "Completed",
                                  color:
                                    "bg-green-100 text-green-800 border-green-300",
                                },
                                {
                                  value: "cancelled",
                                  label: "Cancelled",
                                  color:
                                    "bg-red-100 text-red-800 border-red-300",
                                },
                                {
                                  value: "processing",
                                  label: "Processing",
                                  color:
                                    "bg-brand-50 text-brand-800 border-brand-200",
                                },
                                {
                                  value: "delivered",
                                  label: "Delivered",
                                  color:
                                    "bg-purple-100 text-purple-800 border-purple-300",
                                },
                              ].map((status) => (
                                <Badge
                                  key={status.value}
                                  variant="outline"
                                  className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                    filters.status === status.value
                                      ? `${status.color} border-2`
                                      : "border-gray-300 text-gray-700 hover:border-gray-400"
                                  }`}
                                  onClick={() =>
                                    handleFilterChange(
                                      "status",
                                      filters.status === status.value
                                        ? ""
                                        : status.value
                                    )
                                  }
                                >
                                  {status.label}
                                  {filters.status === status.value && (
                                    <X className="w-3 h-3 ml-1.5" />
                                  )}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="stoveSerialNo">
                              Stove Serial Number
                            </Label>
                            <Input
                              id="stoveSerialNo"
                              placeholder="Enter stove serial number"
                              value={filters.stoveSerialNo}
                              onChange={(e) =>
                                handleFilterChange(
                                  "stoveSerialNo",
                                  e.target.value
                                )
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="stoveSerialNoPattern">
                              Stove Serial Pattern
                            </Label>
                            <Input
                              id="stoveSerialNoPattern"
                              placeholder="Enter pattern (e.g., ST-*-2024)"
                              value={filters.stoveSerialNoPattern}
                              onChange={(e) =>
                                handleFilterChange(
                                  "stoveSerialNoPattern",
                                  e.target.value
                                )
                              }
                            />
                          </div>
                        </div>

                        {/* Boolean filters */}
                        <div className="mt-6">
                          <Label className="text-base font-medium mb-3 block">
                            Data Validation
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              {
                                key: "hasLocation",
                                label: "Has Location",
                                icon: "📍",
                              },
                              {
                                key: "hasContact",
                                label: "Has Contact",
                                icon: "📞",
                              },
                              {
                                key: "hasAmount",
                                label: "Has Amount",
                                icon: "💰",
                              },
                              {
                                key: "hasStatus",
                                label: "Has Status",
                                icon: "📊",
                              },
                              {
                                key: "isActive",
                                label: "Is Active",
                                icon: "✅",
                              },
                            ].map((item) => (
                              <Badge
                                key={item.key}
                                variant={
                                  filters[item.key] === true
                                    ? "default"
                                    : "outline"
                                }
                                className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                  filters[item.key] === true
                                    ? "bg-green-600 text-white hover:bg-green-700"
                                    : "border-gray-300 text-gray-700 hover:border-green-500 hover:text-green-600"
                                }`}
                                onClick={() =>
                                  handleFilterChange(
                                    item.key,
                                    filters[item.key] === true ? null : true
                                  )
                                }
                              >
                                <span className="mr-1.5">{item.icon}</span>
                                {item.label}
                                {filters[item.key] === true && (
                                  <X className="w-3 h-3 ml-1.5" />
                                )}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                {/* Advanced Options */}
                <AccordionItem value="advanced">
                  <AccordionTrigger className="text-lg font-semibold">
                    <div className="flex items-center gap-2 text-gray-800">
                      <Settings className="w-5 h-5" />
                      Advanced Options
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="limit">Results Limit</Label>
                            <Select
                              value={filters.limit.toString()}
                              onValueChange={(value) =>
                                handleFilterChange("limit", parseInt(value))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select limit" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="25">25</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                                <SelectItem value="100">100</SelectItem>
                                <SelectItem value="500">500</SelectItem>
                                <SelectItem value="1000">1000</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <Label className="text-base font-medium">
                              Export Format
                            </Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {[
                                { value: "csv", label: "CSV", icon: "📄" },
                                { value: "excel", label: "Excel", icon: "📊" },
                                { value: "pdf", label: "PDF", icon: "📕" },
                                { value: "json", label: "JSON", icon: "🔗" },
                              ].map((format) => (
                                <Badge
                                  key={format.value}
                                  variant={
                                    filters.exportFormat === format.value
                                      ? "default"
                                      : "outline"
                                  }
                                  className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                    filters.exportFormat === format.value
                                      ? "bg-indigo-600 text-white hover:bg-indigo-700"
                                      : "border-gray-300 text-gray-700 hover:border-indigo-500 hover:text-indigo-600"
                                  }`}
                                  onClick={() =>
                                    handleFilterChange(
                                      "exportFormat",
                                      format.value
                                    )
                                  }
                                >
                                  <span className="mr-1.5">{format.icon}</span>
                                  {format.label}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-base font-medium">
                              Sort Order
                            </Label>
                            <div className="flex gap-2 mt-2">
                              {[
                                {
                                  value: "asc",
                                  label: "Ascending",
                                  icon: "⬆️",
                                },
                                {
                                  value: "desc",
                                  label: "Descending",
                                  icon: "⬇️",
                                },
                              ].map((order) => (
                                <Badge
                                  key={order.value}
                                  variant={
                                    filters.orderDirection === order.value
                                      ? "default"
                                      : "outline"
                                  }
                                  className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                    filters.orderDirection === order.value
                                      ? "bg-gray-800 text-white hover:bg-gray-900"
                                      : "border-gray-300 text-gray-700 hover:border-gray-800 hover:text-gray-800"
                                  }`}
                                  onClick={() =>
                                    handleFilterChange(
                                      "orderDirection",
                                      order.value
                                    )
                                  }
                                >
                                  <span className="mr-1.5">{order.icon}</span>
                                  {order.label}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="mt-6">
                          <Label className="text-base font-medium mb-3 block">
                            Performance Options
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              {
                                key: "skipCache",
                                label: "Skip Cache",
                                icon: "⚡",
                              },
                              {
                                key: "realTime",
                                label: "Real Time",
                                icon: "🔄",
                              },
                              {
                                key: "includeHeaders",
                                label: "Include Headers",
                                icon: "📋",
                              },
                            ].map((item) => (
                              <Badge
                                key={item.key}
                                variant={
                                  filters[item.key] ? "default" : "outline"
                                }
                                className={`cursor-pointer transition-all duration-200 hover:scale-105 text-xs sm:text-sm px-3 py-1.5 ${
                                  filters[item.key]
                                    ? "bg-orange-600 text-white hover:bg-orange-700"
                                    : "border-gray-300 text-gray-700 hover:border-orange-500 hover:text-orange-600"
                                }`}
                                onClick={() =>
                                  handleFilterChange(
                                    item.key,
                                    !filters[item.key]
                                  )
                                }
                              >
                                <span className="mr-1.5">{item.icon}</span>
                                {item.label}
                                {filters[item.key] && (
                                  <X className="w-3 h-3 ml-1.5" />
                                )}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {/* Save/Load Filters */}
                        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                          <Label className="text-base font-medium">
                            Save/Load Filters
                          </Label>
                          <div className="mt-2 flex gap-2">
                            <Input
                              placeholder="Filter name..."
                              value={filterName}
                              onChange={(e) => setFilterName(e.target.value)}
                              className="flex-1"
                            />
                            <Button
                              onClick={saveFilter}
                              disabled={!filterName.trim()}
                            >
                              <Save className="w-4 h-4 mr-2" />
                              Save
                            </Button>
                          </div>

                          {savedFilters.length > 0 && (
                            <div className="mt-3">
                              <Label className="text-sm text-gray-600">
                                Saved Filters:
                              </Label>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {savedFilters.map((saved, index) => (
                                  <Button
                                    key={index}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => loadFilter(saved)}
                                  >
                                    {saved.name}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SalesAdvancedFilter;
