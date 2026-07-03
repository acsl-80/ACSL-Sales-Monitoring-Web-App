
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Copy, AlertCircle } from "lucide-react";
import { AgentCredentials } from "@/types/salesAgent";

interface AgentCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  credentials: AgentCredentials | null;
}

const AgentCredentialsModal: React.FC<AgentCredentialsModalProps> = ({
  isOpen,
  onClose,
  credentials,
}) => {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // You could add a toast notification here
    });
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Agent Created Successfully!
          </DialogTitle>
          <DialogDescription>
            The sales agent account has been created. Please share these login
            credentials with the agent.
          </DialogDescription>
        </DialogHeader>

        {credentials && (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h4 className="font-semibold text-green-800 mb-3">
                Login Credentials
              </h4>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 bg-white rounded border">
                  <div>
                    <Label className="text-xs text-gray-600">Agent Name</Label>
                    <p className="font-medium">{credentials.name}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(credentials.name)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center justify-between p-2 bg-white rounded border">
                  <div>
                    <Label className="text-xs text-gray-600">Email</Label>
                    <p className="font-medium">{credentials.email}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(credentials.email)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center justify-between p-2 bg-white rounded border">
                  <div>
                    <Label className="text-xs text-gray-600">
                      Temporary Password
                    </Label>
                    <p className="font-mono text-sm">{credentials.password}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(credentials.password)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="text-sm text-yellow-800">
                  <p className="font-semibold mb-1">Important Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>The agent must change this password on first login</li>
                    <li>These credentials will only be shown once</li>
                    <li>Make sure to securely share these with the agent</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleClose}
                className="bg-brand hover:bg-brand-700 text-white"
              >
                Got it, thanks!
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AgentCredentialsModal;
