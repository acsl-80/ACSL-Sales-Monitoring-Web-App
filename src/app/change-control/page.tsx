import { ClipboardList, Loader2, Plus } from "lucide-react";
import { useRouter } from "@/compat/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import PageHeader from "../components/PageHeader";
import { formatDate } from "../utils/formatDate";
import ChangeControlGuard from "./components/ChangeControlGuard";
import StatusChip from "./components/StatusChip";
import { useMyRequests } from "./hooks/useMyRequests";

/** /change-control — every request this person has raised, newest last-change first. */
export default function ChangeControlListPage() {
  const router = useRouter();
  const { requests, isLoading, error } = useMyRequests();

  return (
    <ChangeControlGuard
      title="My requests"
      description="Change requests you have raised from this app"
    >
      <div className="p-6 space-y-4">
        <PageHeader
          icon={ClipboardList}
          title="My requests"
          right={
            <Button
              onClick={() => router.push("/change-control/new")}
              className="bg-brand hover:bg-brand/90 text-white"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Request a change
            </Button>
          }
        />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
          </div>
        )}

        {!isLoading && !error && requests.length === 0 && (
          <Card>
            <CardContent className="space-y-2 p-8 text-center">
              <p className="text-gray-600">You have not raised anything yet.</p>
              <p className="text-sm text-gray-500">
                Use Request a change at the foot of the menu on any page, or the button above, and
                it will appear here.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && requests.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => router.push(`/change-control/${r.ref}`)}
                  >
                    <TableCell className="font-mono text-xs">{r.ref}</TableCell>
                    <TableCell className="max-w-xs truncate" title={r.title}>
                      {r.title}
                    </TableCell>
                    <TableCell>
                      <StatusChip label={r.status_label} tone={r.status_tone} />
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {formatDate(r.status_changed_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ChangeControlGuard>
  );
}
