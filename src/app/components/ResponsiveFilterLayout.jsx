
import React, { useState } from "react";
import { Button, Drawer } from "antd";
import { FilterOutlined, CloseOutlined } from "@ant-design/icons";

const ResponsiveFilterLayout = ({ filterComponent, children }) => {
  const [filterDrawerVisible, setFilterDrawerVisible] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Mobile Filter Button */}
      <div className="lg:hidden fixed bottom-6 right-6 z-50">
        <Button
          type="primary"
          size="large"
          icon={<FilterOutlined />}
          onClick={() => setFilterDrawerVisible(true)}
          className="shadow-lg rounded-full w-14 h-14 flex items-center justify-center"
        ></Button>
      </div>

      {/* Mobile Filter Drawer */}
      <Drawer
        title={
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">Advanced Filters</span>
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setFilterDrawerVisible(false)}
            />
          </div>
        }
        placement="bottom"
        height="90%"
        open={filterDrawerVisible}
        onClose={() => setFilterDrawerVisible(false)}
        className="lg:hidden"
        bodyStyle={{ padding: 16 }}
      >
        {filterComponent}
      </Drawer>

      {/* Desktop Layout */}
      <div className="lg:flex lg:flex-col">
        {/* Desktop Filters */}
        <div className="hidden lg:block">{filterComponent}</div>

        {/* Content */}
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
};

export default ResponsiveFilterLayout;
