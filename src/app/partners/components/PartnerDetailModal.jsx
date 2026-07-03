import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DetailItem = ({ label, value, span2 = false }) => (
  <div className={`space-y-0.5 ${span2 ? "md:col-span-2" : ""}`}>
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
    <p className="text-xs font-medium text-gray-900">{value || <span className="text-gray-400">N/A</span>}</p>
  </div>
);

const SectionCard = ({ title, children }) => (
  <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-1 mb-3">{title}</h3>
    {children}
  </div>
);

const PartnerDetailModal = ({ organization, isOpen, onClose }) => {
  if (!organization) return null;
  const formatDate = (d) => {
    if (!d) return "N/A";
    try {
      return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return "N/A";
    }
  };
  const typeLabel = organization.partner_type
    ? organization.partner_type.charAt(0).toUpperCase() + organization.partner_type.slice(1)
    : "N/A";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-gradient-to-r from-blue-50/80 to-sky-50/80 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold">Partner Details</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{organization.partner_name}</p>
            </div>
            {organization.status && (
              <span
                className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                  organization.status === "active"
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-50 text-gray-600 border-gray-200"
                }`}
              >
                {organization.status.charAt(0).toUpperCase() + organization.status.slice(1)}
              </span>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <SectionCard title="Partner Information">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <DetailItem label="Partner Name" value={organization.partner_name} />
              <DetailItem label="Partner ID" value={organization.partner_id} />
              <DetailItem label="Type" value={typeLabel} />
              <DetailItem label="Branch" value={organization.branch} />
              <DetailItem label="State" value={organization.state} />
              <DetailItem label="Date Joined" value={formatDate(organization.created_at)} />
            </div>
          </SectionCard>
          <SectionCard title="Contact Information">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <DetailItem label="Contact Person" value={organization.contact_person} />
              <DetailItem label="Contact Phone" value={organization.contact_phone} />
              <DetailItem label="Alternative Phone" value={organization.alternative_phone} />
              <DetailItem label="Email" value={organization.email} />
              <DetailItem label="Address" value={organization.address} span2 />
            </div>
          </SectionCard>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PartnerDetailModal;
