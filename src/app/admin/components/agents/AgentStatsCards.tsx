
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Shield, UserPlus } from "lucide-react";
import { SalesAgent } from "@/types/salesAgent";

interface AgentStatsCardsProps {
  agents: SalesAgent[];
}

const AgentStatsCards: React.FC<AgentStatsCardsProps> = ({ agents }) => {
  const totalAgents = agents.length;
  const agentsWithChangedPassword = agents.filter(
    (agent) => agent.has_changed_password
  ).length;
  const newAgents = agents.filter(
    (agent) => !agent.has_changed_password
  ).length;

  // Stats cards removed per product requirements
  return null;
};

export default AgentStatsCards;
