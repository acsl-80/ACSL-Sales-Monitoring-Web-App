
import React, { useState, useEffect } from "react";
import {
  DatePicker,
  Select,
  Input,
  Button,
  Card,
  Row,
  Col,
  Collapse,
  InputNumber,
  Checkbox,
  Badge,
  Tag,
  Space,
  Dropdown,
  Menu,
  Tooltip,
  Switch,
} from "antd";
import {
  SearchOutlined,
  FilterOutlined,
  ClearOutlined,
  DownloadOutlined,
  CalendarOutlined,
  EnvironmentOutlined,
  UserOutlined,
  DollarOutlined,
  SettingOutlined,
  ExportOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { lgaAndStates } from "../constants";

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Panel } = Collapse;

const SalesAdvancedFilter = ({ onFilter, onExport, loading }) => {
  const [filters, setFilters] = useState({
    // Date filters
    dateFrom: null,
    dateTo: null,
    createdFrom: null,
    createdTo: null,
    salesDateFrom: null,
    salesDateTo: null,

    // Quick date filters
    lastNDays: null,
    thisWeek: false,
    thisMonth: false,
    thisYear: false,
    lastWeek: false,
    lastMonth: false,
    lastYear: false,

    // Location filters
    state: null,
    states: [],
    city: null,
    cities: [],
    lga: null,
    lgas: [],
    country: null,

    // Product/Stove filters
    stoveSerialNo: null,
    stoveSerialNos: [],
    stoveSerialNoPattern: null,

    // People filters
    contactPerson: null,
    contactPhone: null,
    endUserName: null,
    aka: null,
    partnerName: null,
    createdBy: null,
    createdByIds: [],

    // Amount filters
    amountMin: null,
    amountMax: null,
    amountExact: null,

    // Status filters
    status: null,
    statuses: [],

    // Phone filters
    phone: null,
    otherPhone: null,
    anyPhone: null,

    // Search filters
    search: null,

    // Advanced filters
    hasStoveImage: false,
    hasAgreementImage: false,
    hasSignature: false,
    hasAddress: false,

    // Pagination
    page: 1,
    limit: 10,

    // Sorting
    sortBy: "created_at",
    sortOrder: "desc",

    // Export options
    export: null,
  });

  const [activeFilters, setActiveFilters] = useState([]);
  const [compactMode, setCompactMode] = useState(false);
  const [savedFilters, setSavedFilters] = useState([]);

  // Load saved filters from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("salesAdvancedFilters");
    if (saved) {
      try {
        setSavedFilters(JSON.parse(saved));
      } catch (e) {
        console.error("Error loading saved filters:", e);
      }
    }
  }, []);

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);

    // Update active filters for display
    const active = Object.entries(newFilters)
      .filter(
        ([k, v]) =>
          v !== null &&
          v !== undefined &&
          v !== "" &&
          v !== false &&
          (Array.isArray(v) ? v.length > 0 : true)
      )
      .map(([k, v]) => ({ key: k, value: v }));
    setActiveFilters(active);
  };

  const applyFilters = () => {
    onFilter(filters);
  };

  const clearFilters = () => {
    const clearedFilters = {
      page: 1,
      limit: 10,
      sortBy: "created_at",
      sortOrder: "desc",
    };
    setFilters(clearedFilters);
    setActiveFilters([]);
    onFilter(clearedFilters);
  };

  const saveFilters = () => {
    const filterName = prompt("Enter a name for this filter:");
    if (filterName) {
      const newSavedFilter = {
        id: Date.now(),
        name: filterName,
        filters: filters,
        createdAt: new Date().toISOString(),
      };
      const updated = [...savedFilters, newSavedFilter];
      setSavedFilters(updated);
      localStorage.setItem("salesAdvancedFilters", JSON.stringify(updated));
    }
  };

  const loadSavedFilter = (savedFilter) => {
    setFilters(savedFilter.filters);
    const active = Object.entries(savedFilter.filters)
      .filter(
        ([k, v]) =>
          v !== null &&
          v !== undefined &&
          v !== "" &&
          v !== false &&
          (Array.isArray(v) ? v.length > 0 : true)
      )
      .map(([k, v]) => ({ key: k, value: v }));
    setActiveFilters(active);
  };

  const handleExport = (format) => {
    onExport({ ...filters, export: format });
  };

  const quickDateFilters = [
    { key: "thisWeek", label: "This Week", color: "#52c41a" },
    { key: "thisMonth", label: "This Month", color: "#1890ff" },
    { key: "thisYear", label: "This Year", color: "#722ed1" },
    { key: "lastWeek", label: "Last Week", color: "#fa8c16" },
    { key: "lastMonth", label: "Last Month", color: "#eb2f96" },
    { key: "lastYear", label: "Last Year", color: "#f5222d" },
  ];

  const statuses = ["pending", "completed", "cancelled", "processing"];

  const exportMenu = (
    <Menu>
      <Menu.Item
        key="csv"
        icon={<ExportOutlined />}
        onClick={() => handleExport("csv")}
      >
        Export as CSV
      </Menu.Item>
      <Menu.Item
        key="xlsx"
        icon={<ExportOutlined />}
        onClick={() => handleExport("xlsx")}
      >
        Export as Excel
      </Menu.Item>
      <Menu.Item
        key="json"
        icon={<ExportOutlined />}
        onClick={() => handleExport("json")}
      >
        Export as JSON
      </Menu.Item>
    </Menu>
  );

  const savedFiltersMenu = (
    <Menu>
      {savedFilters.map((saved) => (
        <Menu.Item key={saved.id} onClick={() => loadSavedFilter(saved)}>
          <div>
            <div className="font-medium">{saved.name}</div>
            <div className="text-xs text-gray-500">
              {new Date(saved.createdAt).toLocaleDateString()}
            </div>
          </div>
        </Menu.Item>
      ))}
      {savedFilters.length === 0 && (
        <Menu.Item disabled>No saved filters</Menu.Item>
      )}
    </Menu>
  );

  return (
    <div className="space-y-6">
      {/* Header Section with Modern Design */}
      <Card className="border-0 shadow-lg bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Advanced Sales Filter
            </h2>
            <p className="text-gray-600">
              Filter and analyze your sales data with powerful search
              capabilities
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Badge count={activeFilters.length} color="#1890ff">
              <Button
                type="primary"
                size="large"
                icon={<FilterOutlined />}
                onClick={applyFilters}
                loading={loading}
                className="shadow-md"
              >
                Apply Filters
              </Button>
            </Badge>
            <Tooltip title="Toggle compact mode">
              <Switch
                checked={compactMode}
                onChange={setCompactMode}
                checkedChildren="Compact"
                unCheckedChildren="Full"
              />
            </Tooltip>
          </div>
        </div>
      </Card>

      {/* Quick Search and Actions */}
      <Card className="border-0 shadow-md">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} lg={12}>
            <Input
              size="large"
              placeholder="🔍 Search across all fields (transaction ID, names, serial numbers...)"
              prefix={<SearchOutlined className="text-gray-400" />}
              value={filters.search}
              onChange={(e) => handleFilterChange("search", e.target.value)}
              onPressEnter={applyFilters}
              className="border-2 border-gray-200 hover:border-blue-400 focus:border-blue-500 rounded-lg"
            />
          </Col>
          <Col xs={24} lg={12}>
            <Space wrap className="w-full justify-end">
              <Dropdown overlay={savedFiltersMenu} placement="bottomRight">
                <Button icon={<ReloadOutlined />} size="large">
                  Load Saved
                </Button>
              </Dropdown>
              <Button
                icon={<SaveOutlined />}
                onClick={saveFilters}
                size="large"
                disabled={activeFilters.length === 0}
              >
                Save Filter
              </Button>
              <Dropdown overlay={exportMenu} placement="bottomRight">
                <Button icon={<DownloadOutlined />} size="large" type="default">
                  Export
                </Button>
              </Dropdown>
              <Button
                size="large"
                icon={<ClearOutlined />}
                onClick={clearFilters}
                danger
              >
                Clear All
              </Button>
            </Space>
          </Col>
        </Row>

        {/* Active Filters Display */}
        {activeFilters.length > 0 && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border-l-4 border-blue-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-blue-800 flex items-center">
                <FilterOutlined className="mr-1" />
                Active Filters ({activeFilters.length}):
              </span>
              {activeFilters.map(({ key, value }) => (
                <Tag
                  key={key}
                  color="blue"
                  closable
                  onClose={() =>
                    handleFilterChange(
                      key,
                      Array.isArray(filters[key]) ? [] : null
                    )
                  }
                  className="flex items-center"
                >
                  <span className="font-medium">
                    {key.replace(/([A-Z])/g, " $1").toLowerCase()}:
                  </span>
                  <span className="ml-1">
                    {Array.isArray(value) ? value.join(", ") : value.toString()}
                  </span>
                </Tag>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Filter Panels */}
      <Card className="border-0 shadow-md">
        <Collapse
          ghost
          size={compactMode ? "small" : "default"}
          className="bg-white rounded-lg"
        >
          {/* Quick Date Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <CalendarOutlined className="text-green-500" />
                <span className="font-semibold">Quick Date Filters</span>
              </div>
            }
            key="quickDate"
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {quickDateFilters.map(({ key, label, color }) => (
                <div
                  key={key}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                    filters[key]
                      ? "border-blue-400 bg-blue-50 shadow-md"
                      : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                  }`}
                  onClick={() => handleFilterChange(key, !filters[key])}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-medium ${
                        filters[key] ? "text-blue-700" : "text-gray-700"
                      }`}
                    >
                      {label}
                    </span>
                    <div
                      className={`w-3 h-3 rounded-full ${
                        filters[key] ? "bg-blue-500" : "bg-gray-300"
                      }`}
                      style={{
                        backgroundColor: filters[key] ? color : undefined,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          {/* Date Range Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <CalendarOutlined className="text-blue-500" />
                <span className="font-semibold">📅 Date Range Filters</span>
              </div>
            }
            key="date"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Sales Date Range</label>
                  <RangePicker
                    className="w-full filter-input"
                    value={
                      filters.salesDateFrom && filters.salesDateTo
                        ? [filters.salesDateFrom, filters.salesDateTo]
                        : null
                    }
                    onChange={(dates) => {
                      handleFilterChange("salesDateFrom", dates?.[0] || null);
                      handleFilterChange("salesDateTo", dates?.[1] || null);
                    }}
                    placeholder={["Start Date", "End Date"]}
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Created Date Range</label>
                  <RangePicker
                    showTime
                    className="w-full filter-input"
                    value={
                      filters.createdFrom && filters.createdTo
                        ? [filters.createdFrom, filters.createdTo]
                        : null
                    }
                    onChange={(dates) => {
                      handleFilterChange("createdFrom", dates?.[0] || null);
                      handleFilterChange("createdTo", dates?.[1] || null);
                    }}
                    placeholder={["Start DateTime", "End DateTime"]}
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Last N Days</label>
                  <InputNumber
                    className="w-full filter-input"
                    placeholder="e.g., 30"
                    value={filters.lastNDays}
                    onChange={(value) => handleFilterChange("lastNDays", value)}
                    min={1}
                    max={365}
                  />
                </div>
              </Col>
            </Row>
          </Panel>

          {/* Location Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <EnvironmentOutlined className="text-green-500" />
                <span className="font-semibold">📍 Location Filters</span>
              </div>
            }
            key="location"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">Country</label>
                  <Input
                    placeholder="e.g., Nigeria"
                    value={filters.country}
                    onChange={(e) =>
                      handleFilterChange("country", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">State(s)</label>
                  <Select
                    mode="multiple"
                    className="w-full filter-input"
                    placeholder="Select states"
                    value={filters.states}
                    onChange={(value) => handleFilterChange("states", value)}
                    showSearch
                    optionFilterProp="children"
                    maxTagCount="responsive"
                  >
                    {Object.keys(lgaAndStates).map((state) => (
                      <Option key={state} value={state}>
                        {state}
                      </Option>
                    ))}
                  </Select>
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">LGA(s)</label>
                  <Select
                    mode="multiple"
                    className="w-full filter-input"
                    placeholder="Select LGAs"
                    value={filters.lgas}
                    onChange={(value) => handleFilterChange("lgas", value)}
                    showSearch
                    optionFilterProp="children"
                    disabled={filters.states.length === 0}
                    maxTagCount="responsive"
                  >
                    {filters.states.flatMap(
                      (state) =>
                        lgaAndStates[state]?.map((lga) => (
                          <Option key={`${state}-${lga}`} value={lga}>
                            {lga}
                          </Option>
                        )) || []
                    )}
                  </Select>
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">City</label>
                  <Input
                    placeholder="e.g., Lagos"
                    value={filters.city}
                    onChange={(e) => handleFilterChange("city", e.target.value)}
                    className="filter-input"
                  />
                </div>
              </Col>
            </Row>
          </Panel>

          {/* Product/Stove Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <SettingOutlined className="text-orange-500" />
                <span className="font-semibold">🔧 Product/Stove Filters</span>
              </div>
            }
            key="product"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Stove Serial Number</label>
                  <Input
                    placeholder="Exact serial number"
                    value={filters.stoveSerialNo}
                    onChange={(e) =>
                      handleFilterChange("stoveSerialNo", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Serial Number Pattern</label>
                  <Input
                    placeholder="Pattern (e.g., STV)"
                    value={filters.stoveSerialNoPattern}
                    onChange={(e) =>
                      handleFilterChange("stoveSerialNoPattern", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">
                    Multiple Serial Numbers
                  </label>
                  <Select
                    mode="tags"
                    className="w-full filter-input"
                    placeholder="Enter serial numbers"
                    value={filters.stoveSerialNos}
                    onChange={(value) =>
                      handleFilterChange("stoveSerialNos", value)
                    }
                    maxTagCount="responsive"
                  />
                </div>
              </Col>
            </Row>
          </Panel>

          {/* People Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <UserOutlined className="text-purple-500" />
                <span className="font-semibold">👥 People Filters</span>
              </div>
            }
            key="people"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">Contact Person</label>
                  <Input
                    placeholder="Contact person name"
                    value={filters.contactPerson}
                    onChange={(e) =>
                      handleFilterChange("contactPerson", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">End User Name</label>
                  <Input
                    placeholder="End user name"
                    value={filters.endUserName}
                    onChange={(e) =>
                      handleFilterChange("endUserName", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">Partner Name</label>
                  <Input
                    placeholder="Partner name"
                    value={filters.partnerName}
                    onChange={(e) =>
                      handleFilterChange("partnerName", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="filter-group">
                  <label className="filter-label">AKA</label>
                  <Input
                    placeholder="Also known as"
                    value={filters.aka}
                    onChange={(e) => handleFilterChange("aka", e.target.value)}
                    className="filter-input"
                  />
                </div>
              </Col>
            </Row>
          </Panel>

          {/* Amount Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <DollarOutlined className="text-green-600" />
                <span className="font-semibold">💰 Amount Filters</span>
              </div>
            }
            key="amount"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Minimum Amount</label>
                  <InputNumber
                    className="w-full filter-input"
                    formatter={(value) =>
                      `₦ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                    }
                    parser={(value) => value.replace(/\₦\s?|(,*)/g, "")}
                    value={filters.amountMin}
                    onChange={(value) => handleFilterChange("amountMin", value)}
                    placeholder="Min amount"
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Maximum Amount</label>
                  <InputNumber
                    className="w-full filter-input"
                    formatter={(value) =>
                      `₦ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                    }
                    parser={(value) => value.replace(/\₦\s?|(,*)/g, "")}
                    value={filters.amountMax}
                    onChange={(value) => handleFilterChange("amountMax", value)}
                    placeholder="Max amount"
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Exact Amount</label>
                  <InputNumber
                    className="w-full filter-input"
                    formatter={(value) =>
                      `₦ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                    }
                    parser={(value) => value.replace(/\₦\s?|(,*)/g, "")}
                    value={filters.amountExact}
                    onChange={(value) =>
                      handleFilterChange("amountExact", value)
                    }
                    placeholder="Exact amount"
                  />
                </div>
              </Col>
            </Row>
          </Panel>

          {/* Contact & Status Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <span className="text-indigo-500">📱</span>
                <span className="font-semibold">Contact & Status Filters</span>
              </div>
            }
            key="contact"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Contact Phone</label>
                  <Input
                    placeholder="+2348012345678"
                    value={filters.contactPhone}
                    onChange={(e) =>
                      handleFilterChange("contactPhone", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Any Phone</label>
                  <Input
                    placeholder="Search in all phone fields"
                    value={filters.anyPhone}
                    onChange={(e) =>
                      handleFilterChange("anyPhone", e.target.value)
                    }
                    className="filter-input"
                  />
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Status</label>
                  <Select
                    mode="multiple"
                    className="w-full filter-input"
                    placeholder="Select statuses"
                    value={filters.statuses}
                    onChange={(value) => handleFilterChange("statuses", value)}
                    maxTagCount="responsive"
                  >
                    {statuses.map((status) => (
                      <Option key={status} value={status}>
                        <div className="flex items-center space-x-2">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              status === "completed"
                                ? "bg-green-500"
                                : status === "pending"
                                ? "bg-yellow-500"
                                : status === "cancelled"
                                ? "bg-red-500"
                                : "bg-blue-500"
                            }`}
                          />
                          <span className="capitalize">{status}</span>
                        </div>
                      </Option>
                    ))}
                  </Select>
                </div>
              </Col>
            </Row>
          </Panel>

          {/* Advanced Filters */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <span className="text-cyan-500">🔍</span>
                <span className="font-semibold">Advanced Filters</span>
              </div>
            }
            key="advanced"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { key: "hasStoveImage", label: "Has Stove Image", icon: "📷" },
                {
                  key: "hasAgreementImage",
                  label: "Has Agreement Image",
                  icon: "📋",
                },
                { key: "hasSignature", label: "Has Signature", icon: "✍️" },
                { key: "hasAddress", label: "Has Address", icon: "🏠" },
              ].map(({ key, label, icon }) => (
                <div
                  key={key}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                    filters[key]
                      ? "border-blue-400 bg-blue-50 shadow-md"
                      : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                  }`}
                  onClick={() => handleFilterChange(key, !filters[key])}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">{icon}</span>
                      <span
                        className={`font-medium text-sm ${
                          filters[key] ? "text-blue-700" : "text-gray-700"
                        }`}
                      >
                        {label}
                      </span>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border-2 ${
                        filters[key]
                          ? "bg-blue-500 border-blue-500"
                          : "border-gray-300"
                      }`}
                    >
                      {filters[key] && (
                        <div className="w-full h-full rounded-full bg-white transform scale-50" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Sorting & Pagination */}
          <Panel
            header={
              <div className="flex items-center space-x-2">
                <span className="text-pink-500">📊</span>
                <span className="font-semibold">Sorting & Pagination</span>
              </div>
            }
            key="sorting"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Sort By</label>
                  <Select
                    className="w-full filter-input"
                    value={filters.sortBy}
                    onChange={(value) => handleFilterChange("sortBy", value)}
                  >
                    <Option value="created_at">📅 Created Date</Option>
                    <Option value="sales_date">🛍️ Sales Date</Option>
                    <Option value="amount">💰 Amount</Option>
                    <Option value="end_user_name">👤 End User Name</Option>
                    <Option value="stove_serial_no">🔧 Stove Serial No</Option>
                  </Select>
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Sort Order</label>
                  <Select
                    className="w-full filter-input"
                    value={filters.sortOrder}
                    onChange={(value) => handleFilterChange("sortOrder", value)}
                  >
                    <Option value="desc">📉 Descending</Option>
                    <Option value="asc">📈 Ascending</Option>
                  </Select>
                </div>
              </Col>
              <Col xs={24} md={8}>
                <div className="filter-group">
                  <label className="filter-label">Results Per Page</label>
                  <Select
                    className="w-full filter-input"
                    value={filters.limit}
                    onChange={(value) => handleFilterChange("limit", value)}
                  >
                    <Option value={10}>10 results</Option>
                    <Option value={25}>25 results</Option>
                    <Option value={50}>50 results</Option>
                    <Option value={100}>100 results</Option>
                    <Option value={250}>250 results</Option>
                    <Option value={500}>500 results</Option>
                  </Select>
                </div>
              </Col>
            </Row>
          </Panel>
        </Collapse>
      </Card>
    </div>
  );
};

export default SalesAdvancedFilter;
