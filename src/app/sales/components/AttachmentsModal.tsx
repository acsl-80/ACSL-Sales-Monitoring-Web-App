import { useState } from "react";
import Modal from "@/components/ui/modal";
import Image from "@/compat/Image";
import { SuperAdminSale } from "@/types/superAdminSales";

type AttachmentModalProps = {
  isOpen: boolean;
  onClose: (open: boolean) => void;
  modalSale: SuperAdminSale | null;
};

const AttachmentsModal = ({
  isOpen,
  onClose,
  modalSale,
}: AttachmentModalProps) => {
  const [preview, setPreview] = useState<{
    src: string;
    title: string;
  } | null>(null);

  const getSignatureSrc = (sig: string) =>
    sig.startsWith("data:") ? sig : `data:image/png;base64,${sig}`;

  return (
    <>
      <Modal
        open={isOpen}
        onOpenChange={onClose}
        title={
          <span className="flex items-center gap-2">View Attachments</span>
        }
        description="Attachments related to this transaction."
        className="max-w-md"
      >
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            Attachments for Transaction:{" "}
            {modalSale?.transaction_id || modalSale?.id}
          </h2>
          {modalSale?.stove_image?.url ||
          modalSale?.agreement_image?.url ||
          modalSale?.signature ? (
            <ul className="space-y-2">
              {modalSale?.stove_image?.url && (
                <li>
                  <button
                    type="button"
                    className="text-blue-600 underline hover:opacity-80"
                    onClick={() =>
                      setPreview({
                        src: modalSale.stove_image!.url!,
                        title: "Stove Image",
                      })
                    }
                  >
                    Stove Image
                  </button>
                </li>
              )}
              {modalSale?.agreement_image?.url && (
                <li>
                  <button
                    type="button"
                    className="text-blue-600 underline hover:opacity-80"
                    onClick={() =>
                      setPreview({
                        src: modalSale.agreement_image!.url!,
                        title: "Agreement Image",
                      })
                    }
                  >
                    Agreement Image
                  </button>
                </li>
              )}
              {modalSale?.signature && (
                <li>
                  <button
                    type="button"
                    className="text-blue-600 underline hover:opacity-80"
                    onClick={() =>
                      setPreview({
                        src: getSignatureSrc(modalSale.signature!),
                        title: "Signature",
                      })
                    }
                  >
                    Signature
                  </button>
                </li>
              )}
            </ul>
          ) : (
            <div className="text-gray-600">
              No attachments available for this sale.
            </div>
          )}
        </div>
      </Modal>

      {/* Preview Modal */}
      {preview && (
        <Modal
          open={true}
          onOpenChange={() => setPreview(null)}
          title={preview.title}
          className="max-w-2xl"
        >
          <div className="relative w-full h-96 flex items-center justify-center">
            <Image
              src={preview.src}
              alt={preview.title}
              fill
              className="object-contain"
              sizes="100vw"
              priority
            />
          </div>
        </Modal>
      )}
    </>
  );
};
//       ) : (
//         <div className="text-gray-600">
//           No attachments available for this sale.
//         </div>
//       )}
//     </div>
//   </Modal>
// );

export default AttachmentsModal;
