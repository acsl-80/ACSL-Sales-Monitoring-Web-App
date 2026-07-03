
import React from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  right?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, description, icon: Icon, right }) => (
  <div className="flex items-start justify-between">
    <div>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-6 w-6 text-gray-800" />}
        <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
      </div>
      {description && <p className={`text-sm text-gray-500 mt-0.5 ${Icon ? "ml-8" : ""}`}>{description}</p>}
    </div>
    {right && <div className="flex-shrink-0">{right}</div>}
  </div>
);

export default PageHeader;
