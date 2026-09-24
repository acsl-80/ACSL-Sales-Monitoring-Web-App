import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "@/compat/navigation";
import Link from "@/compat/Link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToastNotification } from "../../contexts/useToastNotification";
import { attachScreenshots, raiseRequest } from "../api";
import ChangeControlGuard from "../components/ChangeControlGuard";
import ScreenshotPicker from "../components/ScreenshotPicker";
import { useChangeControlForm } from "../hooks/useChangeControlForm";
import { useMyRequests } from "../hooks/useMyRequests";
import { isHttpUrl } from "../lib/url";
import type { ChangeControlOption, PendingFile } from "../types";

const APP_KEY = "sales-web";
const NOT_SURE = "not-sure";
const STEP_LABELS = ["Kind", "Where", "Describe", "Screenshots", "Impact"] as const;

type FormValues = {
  type: string;
  module: string;
  page_url: string;
  title: string;
  what_happened: string;
  what_expected: string;
  impact: string;
};

const EMPTY_VALUES: FormValues = {
  type: "",
  module: "",
  page_url: "",
  title: "",
  what_happened: "",
  what_expected: "",
  impact: "",
};

const revokePendingFiles = (list: PendingFile[]) =>
  list.forEach((f) => URL.revokeObjectURL(f.previewUrl));

/** /change-control/new — raise a change request. Mirrors the ERP's five-step form (kind, where, describe, screenshots, impact), minus the parts this app does not need: no app picker (fixed to sales-web), no similar-requests panel, no "this is my problem too". */
export default function NewChangeRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToastNotification();
  const { data: form, isLoading: formLoading, error: formError } = useChangeControlForm();
  const { refresh } = useMyRequests();

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ref: string } | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Prefilled once from ?from=, and only when it is an actual web link — never
  // a bare path or anything else the sidebar footer did not put there.
  useEffect(() => {
    const from = searchParams.get("from");
    if (from && isHttpUrl(from)) {
      setValues((prev) => (prev.page_url ? prev : { ...prev, page_url: from }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filesRef = useRef<PendingFile[]>(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    return () => {
      revokePendingFiles(filesRef.current);
    };
  }, []);

  const appOption = useMemo(() => form?.lists.app.find((o) => o.key === APP_KEY), [form]);
  const modulesForApp = useMemo(
    () =>
      (form?.lists.module ?? []).filter(
        (m) => (m.meta as { app?: string } | undefined)?.app === APP_KEY,
      ),
    [form],
  );

  const setField = (field: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const validateStep = (index: number): boolean => {
    const next: Record<string, string> = {};
    if (index === 0 && !values.type) next.type = "Choose what kind of request this is.";
    if (index === 1 && values.page_url.trim() && !isHttpUrl(values.page_url.trim())) {
      next.page_url = "Use a web link (starting with http:// or https://), or leave this blank.";
    }
    if (index === 2) {
      const title = values.title.trim();
      const whatHappened = values.what_happened.trim();
      if (title.length < 5 || title.length > 160)
        next.title = "Give it a short name, 5 to 160 characters.";
      if (whatHappened.length < 10)
        next.what_happened = "Say a bit more about what happened (at least 10 characters).";
    }
    if (index === 4 && !values.impact) next.impact = "Choose how much this affects your work.";
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    if (!validateStep(step)) return;
    setSubmitting(true);
    setAttachError(null);
    try {
      const raised = await raiseRequest({
        title: values.title.trim(),
        what_happened: values.what_happened.trim(),
        what_expected: values.what_expected.trim() || undefined,
        type: values.type,
        app: APP_KEY,
        module: values.module || undefined,
        page_url: values.page_url.trim() || undefined,
        impact: values.impact,
        context: {
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          screen:
            typeof window !== "undefined"
              ? `${window.screen.width}x${window.screen.height}`
              : undefined,
        },
      });

      setResult({ ref: raised.ref });

      if (files.length > 0) {
        try {
          await attachScreenshots(
            raised.id,
            files.map((f) => f.file),
          );
        } catch (err) {
          setAttachError(err instanceof Error ? err.message : "Could not attach the screenshots.");
        }
      }
      revokePendingFiles(files);
      setFiles([]);
      void refresh();
    } catch (err) {
      toast.error(
        "Could not raise the request",
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ChangeControlGuard
      title="Request a change"
      description="A bug, a workflow problem, or an idea"
    >
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        {formLoading && (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
          </div>
        )}

        {!formLoading && formError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">
            {formError instanceof Error ? formError.message : "Could not load the form."}
          </div>
        )}

        {!formLoading && !formError && form && !form.open && !result && (
          <Card>
            <CardContent className="p-6 text-gray-600">
              Change Control is not taking new requests at the moment. Try again later.
            </CardContent>
          </Card>
        )}

        {!formLoading && !formError && form && form.open && !result && (
          <>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Request a change</h1>
              <p className="text-sm text-gray-500">
                A bug, something not working as it should, a workflow problem, a change, a new
                feature, or an observation.
              </p>
            </div>

            <StepIndicator step={step} />

            {step === 0 && (
              <StepSection heading="What kind of request?" hint="Pick the one that fits best.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {form.lists.type.map((opt) => (
                    <OptionCard
                      key={opt.key}
                      option={opt}
                      selected={values.type === opt.key}
                      onSelect={() => setField("type", opt.key)}
                    />
                  ))}
                </div>
                {errors.type && <p className="text-sm text-red-600">{errors.type}</p>}
              </StepSection>
            )}

            {step === 1 && (
              <StepSection heading="Where is it?" hint="This tells the team where to look.">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Module</Label>
                    <Select
                      value={values.module || NOT_SURE}
                      onValueChange={(v) => setField("module", v === NOT_SURE ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Not sure" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOT_SURE}>Not sure</SelectItem>
                        {modulesForApp.map((opt) => (
                          <SelectItem key={opt.key} value={opt.key}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Page link (optional)</Label>
                    <Input
                      value={values.page_url}
                      onChange={(e) => setField("page_url", e.target.value)}
                      placeholder="https://..."
                    />
                    {errors.page_url && <p className="text-sm text-red-600">{errors.page_url}</p>}
                  </div>
                </div>
              </StepSection>
            )}

            {step === 2 && (
              <StepSection
                heading="Describe it"
                hint="Enough detail for someone who has never seen this before."
              >
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input
                      value={values.title}
                      onChange={(e) => setField("title", e.target.value)}
                      placeholder="A short name for it, like: Receipt photo will not upload from a phone"
                    />
                    {errors.title && <p className="text-sm text-red-600">{errors.title}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>What happened</Label>
                    <Textarea
                      value={values.what_happened}
                      onChange={(e) => setField("what_happened", e.target.value)}
                      rows={4}
                      placeholder="What did you see?"
                    />
                    {errors.what_happened && (
                      <p className="text-sm text-red-600">{errors.what_happened}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>What should happen (optional)</Label>
                    <Textarea
                      value={values.what_expected}
                      onChange={(e) => setField("what_expected", e.target.value)}
                      rows={3}
                      placeholder="What did you expect instead?"
                    />
                  </div>
                </div>
              </StepSection>
            )}

            {step === 3 && (
              <StepSection
                heading="Screenshots"
                hint="A picture usually explains it faster than words."
              >
                <ScreenshotPicker
                  files={files}
                  onFilesChange={setFiles}
                  maxFiles={form.attachments.max_files}
                  maxMb={form.attachments.max_mb}
                  mimeTypes={form.attachments.mime_types}
                />
              </StepSection>
            )}

            {step === 4 && (
              <StepSection
                heading="How much does it affect your work?"
                hint="This helps the team judge how urgent it is."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {form.lists.impact.map((opt) => (
                    <OptionCard
                      key={opt.key}
                      option={opt}
                      selected={values.impact === opt.key}
                      onSelect={() => setField("impact", opt.key)}
                    />
                  ))}
                </div>
                {errors.impact && <p className="text-sm text-red-600">{errors.impact}</p>}

                <ReviewSummary
                  values={values}
                  appLabel={appOption?.label ?? "Sales web"}
                  typeOptions={form.lists.type}
                  moduleOptions={modulesForApp}
                  impactOptions={form.lists.impact}
                  fileCount={files.length}
                />
              </StepSection>
            )}

            <div className="flex justify-between border-t border-gray-100 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={goBack}
                disabled={step === 0 || submitting}
              >
                Back
              </Button>
              {step < STEP_LABELS.length - 1 ? (
                <Button type="button" onClick={goNext}>
                  Next
                </Button>
              ) : (
                <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit"}
                </Button>
              )}
            </div>
          </>
        )}

        {result && (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-6 w-6" />
                <h1 className="text-xl font-bold">Raised as {result.ref}</h1>
              </div>
              <p className="text-sm text-gray-600">Status changes show in My requests.</p>

              {attachError && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {result.ref} was raised, but the screenshots were not attached: {attachError}
                </div>
              )}

              <div className="flex gap-3">
                <Link
                  href={`/change-control/${result.ref}`}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  View request
                </Link>
                <Button type="button" onClick={() => router.push("/change-control")}>
                  My requests
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ChangeControlGuard>
  );
}

const StepIndicator = ({ step }: { step: number }) => (
  <div className="flex items-center">
    {STEP_LABELS.map((label, i) => (
      <div key={label} className="flex flex-1 items-center last:flex-none">
        <div className="flex flex-col items-center gap-1">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
              i < step
                ? "bg-green-600 text-white"
                : i === step
                  ? "bg-brand text-white"
                  : "bg-gray-200 text-gray-500"
            }`}
          >
            {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
          </div>
          <span className="hidden text-[11px] text-gray-500 sm:block">{label}</span>
        </div>
        {i < STEP_LABELS.length - 1 && (
          <div className={`mx-2 h-0.5 flex-1 ${i < step ? "bg-green-600" : "bg-gray-200"}`} />
        )}
      </div>
    ))}
  </div>
);

const StepSection = ({
  heading,
  hint,
  children,
}: {
  heading: string;
  hint: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-4">
    <div>
      <h2 className="text-lg font-semibold text-gray-800">{heading}</h2>
      <p className="text-sm text-gray-500">{hint}</p>
    </div>
    {children}
  </div>
);

const OptionCard = ({
  option,
  selected,
  onSelect,
}: {
  option: ChangeControlOption;
  selected: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
      selected
        ? "border-brand bg-brand/5 ring-1 ring-brand"
        : "border-gray-200 bg-white hover:bg-gray-50"
    }`}
  >
    <div className="flex w-full items-center justify-between">
      <span className="text-sm font-medium text-gray-800">{option.label}</span>
      {selected && <CheckCircle className="h-4 w-4 text-brand" />}
    </div>
    {option.description && (
      <span className="text-xs text-gray-500">{String(option.description)}</span>
    )}
  </button>
);

const ReviewSummary = ({
  values,
  appLabel,
  typeOptions,
  moduleOptions,
  impactOptions,
  fileCount,
}: {
  values: FormValues;
  appLabel: string;
  typeOptions: ChangeControlOption[];
  moduleOptions: ChangeControlOption[];
  impactOptions: ChangeControlOption[];
  fileCount: number;
}) => {
  const labelFor = (options: ChangeControlOption[], key: string) =>
    options.find((o) => o.key === key)?.label ?? key;

  const rows: [string, string][] = [
    ["Kind", values.type ? labelFor(typeOptions, values.type) : "-"],
    ["App", appLabel],
    ["Module", values.module ? labelFor(moduleOptions, values.module) : "Not sure"],
    ["Page", values.page_url || "-"],
    ["Title", values.title || "-"],
    ["What happened", values.what_happened || "-"],
    ["What should happen", values.what_expected || "-"],
    ["Screenshots", fileCount ? `${fileCount} attached` : "None"],
  ];

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-medium text-gray-700">Review before you submit</h3>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2 text-sm">
            <dt className="w-40 shrink-0 text-gray-500">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-gray-800">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
