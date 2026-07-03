import DashboardLayout from "@/app/components/DashboardLayout";
import { Users } from "lucide-react";

type Group = {
  name: string;
  description: string;
};

const groups: Group[] = [
  { name: "Super Admin", description: "Unrestricted access to every feature, record, and setting in the application." },
  { name: "ACSL Agent Manager", description: "Manages ACSL agents and oversees their assigned partner organizations." },
  { name: "ACSL Agent", description: "Handles assigned partners, manages stoves, and creates sales on their behalf." },
  { name: "Partner", description: "Manages their own organization, partner agents, stoves, and sales records." },
  { name: "Partner Agent", description: "Creates and manages sales for their partner organization." },
];

export default function UserGroupsContent() {
  return (
    <DashboardLayout currentRoute="user-management-groups" title="User Groups">
      <div className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-6 w-6 text-gray-900" />
          <h1 className="text-2xl font-bold text-gray-900">User Groups</h1>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: "#4a5d0f" }}>
                <th className="text-left px-6 py-3 text-white font-semibold w-1/3">Name</th>
                <th className="text-left px-6 py-3 text-white font-semibold">Description</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr
                  key={g.name}
                  className={i % 2 === 1 ? "" : "bg-white"}
                  style={i % 2 === 1 ? { backgroundColor: "#f4f7e3" } : undefined}
                >
                  <td className="px-6 py-4 align-middle">
                    <span className="text-sm font-medium text-gray-900">{g.name}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{g.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
