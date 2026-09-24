import { useMemo } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useParams } from "@/compat/navigation";
import Link from "@/compat/Link";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "../../utils/formatDate";
import ChangeControlGuard from "../components/ChangeControlGuard";
import RequesterActions from "../components/RequesterActions";
import RequestThread from "../components/RequestThread";
import StatusChip from "../components/StatusChip";
import { useMyRequests } from "../hooks/useMyRequests";

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
    <p className="text-sm text-gray-800">{children}</p>
  </div>
);

/** /change-control/$ref — one request: its details, its screenshots, and its thread. */
export default function ChangeControlDetailPage() {
  const { ref } = useParams<{ ref: string }>();
  const { requests, isLoading, isFetching, error, refresh } = useMyRequests();

  const request = useMemo(() => requests.find((r) => r.ref === ref) ?? null, [requests, ref]);
  const mergedTargetKnown = useMemo(
    () => !!request?.merged_into && requests.some((r) => r.ref === request.merged_into),
    [requests, request],
  );

  return (
    <ChangeControlGuard
      title={ref ? `Request ${ref}` : "Request"}
      description="One change request and its thread"
    >
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {isLoading && !request && (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
          </div>
        )}

        {!isLoading && !isFetching && !request && !error && (
          <Card>
            <CardContent className="p-8 text-center text-gray-600">
              There is no request at this reference, or it is not one of yours.
            </CardContent>
          </Card>
        )}

        {request && (
          <>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-gray-500">{request.ref}</span>
                <StatusChip label={request.status_label} tone={request.status_tone} />
              </div>
              <h1 className="text-2xl font-bold text-gray-800">{request.title}</h1>
            </div>

            {request.merged_into && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                This request was merged into{" "}
                {mergedTargetKnown ? (
                  <Link
                    href={`/change-control/${request.merged_into}`}
                    className="text-brand underline"
                  >
                    {request.merged_into}
                  </Link>
                ) : (
                  <span className="font-mono">{request.merged_into}</span>
                )}
                . Its status keeps updating here.
              </div>
            )}

            {request.limited && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                The team has limited what is shown for this request. Its status still updates here.
              </div>
            )}

            <Card>
              <CardContent className="grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2">
                <Field label="Kind">{request.type_label}</Field>
                <Field label="Where">
                  {request.app_label}
                  {request.module_label ? ` / ${request.module_label}` : ""}
                </Field>
                <Field label="Impact">{request.impact_label}</Field>
                <Field label="Raised">{formatDate(request.created_at)}</Field>
                <Field label="Last change">{formatDate(request.status_changed_at)}</Field>
                {request.page_url && (
                  <Field label="Page">
                    <a
                      href={request.page_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                    >
                      {request.page_url} <ExternalLink className="h-3 w-3" />
                    </a>
                  </Field>
                )}
              </CardContent>
            </Card>

            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-gray-700">What happened</h2>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{request.what_happened}</p>
            </section>

            {request.what_expected && (
              <section className="space-y-1">
                <h2 className="text-sm font-semibold text-gray-700">What should happen</h2>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{request.what_expected}</p>
              </section>
            )}

            {request.summary && (
              <section className="space-y-1">
                <h2 className="text-sm font-semibold text-gray-700">The reviewer&apos;s summary</h2>
                <p className="text-sm text-gray-700">{request.summary}</p>
              </section>
            )}

            {request.files > 0 && (
              <p className="text-sm text-gray-600">
                {request.files} {request.files === 1 ? "screenshot" : "screenshots"} attached.
              </p>
            )}

            <RequesterActions request={request} onDone={refresh} />

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Thread</h2>
              <RequestThread request={request} onPosted={refresh} />
            </section>
          </>
        )}

        <div className="pt-2">
          <Link href="/change-control" className="text-sm text-brand hover:underline">
            Back to My requests
          </Link>
        </div>
      </div>
    </ChangeControlGuard>
  );
}
