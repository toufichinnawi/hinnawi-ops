import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Mail, Paperclip, Search, RefreshCw, FileText, Download, Eye,
  CheckCircle2, Clock, AlertCircle, Inbox, MailOpen, ArrowLeft, Sparkles, ExternalLink,
  Plus, FileUp, Link2
} from "lucide-react";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(val);
}

type EmailItem = {
  id: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  receivedDateTime: string;
  hasAttachments: boolean;
  isRead: boolean;
  bodyPreview: string;
  importance: string;
};

type AttachmentItem = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
};

export default function EmailInbox() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [extractDialogOpen, setExtractDialogOpen] = useState(false);
  const [extractingAttachment, setExtractingAttachment] = useState<{ messageId: string; attachmentId: string; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState("inbox");
  const [createInvoiceDialogOpen, setCreateInvoiceDialogOpen] = useState(false);
  const [selectedProcessedEmail, setSelectedProcessedEmail] = useState<any>(null);
  const [invoiceFormLocation, setInvoiceFormLocation] = useState<string>("");
  const [invoiceFormSupplier, setInvoiceFormSupplier] = useState("");
  const [invoiceFormTotal, setInvoiceFormTotal] = useState("");
  const pageSize = 25;

  const emailsQuery = trpc.email.list.useQuery({
    top: pageSize,
    skip: page * pageSize,
    search: search || undefined,
    hasAttachments: attachmentsOnly || undefined,
  });

  const selectedEmailQuery = trpc.email.get.useQuery(
    { messageId: selectedEmail! },
    { enabled: !!selectedEmail }
  );

  const attachmentsQuery = trpc.email.attachments.useQuery(
    { messageId: selectedEmail! },
    { enabled: !!selectedEmail }
  );

  const processedQuery = trpc.email.processedEmails.useQuery();
  const statsQuery = trpc.email.stats.useQuery();
  const { data: locationsList } = trpc.locations.list.useQuery();
  const { data: suppliersList } = trpc.suppliers.list.useQuery();

  const extractMutation = trpc.email.extractInvoice.useMutation({
    onSuccess: (data) => {
      toast.success(`Invoice extracted: ${data.extracted.supplierName} - $${data.extracted.totalAmount}`);
      setExtractDialogOpen(false);
      processedQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Extraction failed: ${err.message}`);
    },
  });

  const downloadMutation = trpc.email.downloadAttachment.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success(`Downloaded: ${data.name}`);
    },
    onError: (err) => {
      toast.error(`Download failed: ${err.message}`);
    },
  });

  const markReadMutation = trpc.email.markAsRead.useMutation();

  const createInvoiceFromEmailMutation = trpc.email.createInvoiceFromEmail.useMutation({
    onSuccess: (data) => {
      toast.success(`Invoice #${data.invoiceId} created${data.supplierMatched ? ` for ${data.supplierName}` : " (supplier not matched)"}`);
      setCreateInvoiceDialogOpen(false);
      setSelectedProcessedEmail(null);
      processedQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Failed to create invoice: ${err.message}`);
    },
  });

  const emails = emailsQuery.data?.emails || [];
  const totalCount = emailsQuery.data?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleEmailClick = (emailId: string, isRead: boolean) => {
    setSelectedEmail(emailId);
    if (!isRead) {
      markReadMutation.mutate({ messageId: emailId });
    }
  };

  const handleExtract = (messageId: string, attachmentId: string, name: string) => {
    setExtractingAttachment({ messageId, attachmentId, name });
    setExtractDialogOpen(true);
  };

  const confirmExtract = () => {
    if (!extractingAttachment) return;
    extractMutation.mutate({
      messageId: extractingAttachment.messageId,
      attachmentId: extractingAttachment.attachmentId,
    });
  };

  const handleCreateInvoice = (pe: any) => {
    setSelectedProcessedEmail(pe);
    setInvoiceFormSupplier(pe.extractedSupplier || "");
    setInvoiceFormTotal(pe.extractedAmount ? String(Number(pe.extractedAmount).toFixed(2)) : "0.00");
    setInvoiceFormLocation("");
    setCreateInvoiceDialogOpen(true);
  };

  const confirmCreateInvoice = () => {
    if (!selectedProcessedEmail) return;
    createInvoiceFromEmailMutation.mutate({
      processedEmailId: selectedProcessedEmail.id,
      locationId: invoiceFormLocation ? Number(invoiceFormLocation) : undefined,
      overrideSupplier: invoiceFormSupplier || undefined,
      overrideTotal: invoiceFormTotal || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Inbox</h1>
          <p className="text-muted-foreground">accounting@bagelandcafe.com — Microsoft Graph</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => emailsQuery.refetch()}>
            <RefreshCw className={`h-4 w-4 mr-1 ${emailsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <Mail className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Emails</p>
                <p className="text-xl font-semibold">{totalCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-50 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Processed</p>
                <p className="text-xl font-semibold">{statsQuery.data?.processed || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-xl font-semibold">{statsQuery.data?.pending || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertCircle className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Errors</p>
                <p className="text-xl font-semibold">{statsQuery.data?.error || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox">
            <Inbox className="h-4 w-4 mr-1" /> Inbox
          </TabsTrigger>
          <TabsTrigger value="processed">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Processed Emails
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          {/* Search & Filters */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search emails..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-9"
              />
            </div>
            <Button
              variant={attachmentsOnly ? "default" : "outline"}
              size="sm"
              onClick={() => { setAttachmentsOnly(!attachmentsOnly); setPage(0); }}
            >
              <Paperclip className="h-4 w-4 mr-1" />
              Attachments Only
            </Button>
          </div>

          <div className="flex gap-4">
            {/* Email List */}
            <Card className={`${selectedEmail ? "w-2/5" : "w-full"} transition-all`}>
              <CardContent className="p-0">
                {emailsQuery.isLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="flex gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : emailsQuery.data?.error ? (
                  <div className="p-8 text-center">
                    <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">{emailsQuery.data.error}</p>
                  </div>
                ) : emails.length === 0 ? (
                  <div className="p-8 text-center">
                    <MailOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No emails found</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {emails.map((email: EmailItem) => (
                      <button
                        key={email.id}
                        onClick={() => handleEmailClick(email.id, email.isRead)}
                        className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${
                          selectedEmail === email.id ? "bg-muted" : ""
                        } ${!email.isRead ? "bg-blue-50/50" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`h-2 w-2 rounded-full mt-2 flex-shrink-0 ${!email.isRead ? "bg-blue-500" : "bg-transparent"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-sm truncate ${!email.isRead ? "font-semibold" : "font-medium"}`}>
                                {email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Unknown"}
                              </span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {formatDate(email.receivedDateTime)}
                              </span>
                            </div>
                            <p className={`text-sm truncate ${!email.isRead ? "font-medium" : "text-muted-foreground"}`}>
                              {email.subject || "(No subject)"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {email.bodyPreview}
                            </p>
                            <div className="flex gap-1 mt-1">
                              {email.hasAttachments && (
                                <Badge variant="outline" className="text-xs px-1.5 py-0">
                                  <Paperclip className="h-3 w-3 mr-0.5" /> Attachment
                                </Badge>
                              )}
                              {email.importance === "high" && (
                                <Badge variant="destructive" className="text-xs px-1.5 py-0">Important</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      Page {page + 1} of {totalPages} ({totalCount} emails)
                    </span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Email Detail */}
            {selectedEmail && (
              <Card className="w-3/5">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedEmail(null)}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </div>
                  {selectedEmailQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  ) : selectedEmailQuery.data ? (
                    <>
                      <CardTitle className="text-lg">{selectedEmailQuery.data.subject || "(No subject)"}</CardTitle>
                      <CardDescription>
                        From: {selectedEmailQuery.data.from?.emailAddress?.name} &lt;{selectedEmailQuery.data.from?.emailAddress?.address}&gt;
                        <br />
                        Received: {new Date(selectedEmailQuery.data.receivedDateTime).toLocaleString()}
                      </CardDescription>
                    </>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {/* Attachments */}
                  {attachmentsQuery.data && attachmentsQuery.data.length > 0 && (
                    <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                        <Paperclip className="h-4 w-4" />
                        Attachments ({attachmentsQuery.data.length})
                      </h4>
                      <div className="space-y-2">
                        {attachmentsQuery.data.map((att: AttachmentItem) => (
                          <div key={att.id} className="flex items-center justify-between bg-background rounded-md p-2 border">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{att.name}</p>
                                <p className="text-xs text-muted-foreground">{formatSize(att.size)} · {att.contentType}</p>
                              </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadMutation.mutate({ messageId: selectedEmail!, attachmentId: att.id })}
                                disabled={downloadMutation.isPending}
                              >
                                <Download className="h-3 w-3 mr-1" />
                                Save
                              </Button>
                              {(att.contentType.includes("pdf") || att.contentType.includes("image")) && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleExtract(selectedEmail!, att.id, att.name)}
                                  disabled={extractMutation.isPending}
                                >
                                  <Sparkles className="h-3 w-3 mr-1" />
                                  Extract Invoice
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Email Body */}
                  {selectedEmailQuery.data?.body ? (
                    <div className="prose prose-sm max-w-none">
                      {selectedEmailQuery.data.body.contentType === "html" ? (
                        <div
                          className="text-sm [&_*]:max-w-full [&_img]:max-w-full overflow-auto"
                          dangerouslySetInnerHTML={{ __html: selectedEmailQuery.data.body.content }}
                        />
                      ) : (
                        <pre className="text-sm whitespace-pre-wrap font-sans">{selectedEmailQuery.data.body.content}</pre>
                      )}
                    </div>
                  ) : selectedEmailQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-4/6" />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="processed" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Processed Emails</CardTitle>
              <CardDescription>Emails that have been scanned and invoices extracted. Click "Create Invoice" to turn extracted data into an invoice record.</CardDescription>
            </CardHeader>
            <CardContent>
              {processedQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : processedQuery.data?.emails.length === 0 ? (
                <div className="text-center py-8">
                  <MailOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No processed emails yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Open an email with attachments and click "Extract Invoice" to get started</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium">Subject</th>
                        <th className="text-left py-2 px-3 font-medium">Sender</th>
                        <th className="text-left py-2 px-3 font-medium">Supplier</th>
                        <th className="text-right py-2 px-3 font-medium">Amount</th>
                        <th className="text-left py-2 px-3 font-medium">Invoice #</th>
                        <th className="text-left py-2 px-3 font-medium">Date</th>
                        <th className="text-left py-2 px-3 font-medium">File</th>
                        <th className="text-left py-2 px-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedQuery.data?.emails.map((pe: any) => (
                        <tr key={pe.id} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-3">
                            {pe.status === "processed" && !pe.linkedInvoiceId && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Extracted</Badge>}
                            {pe.status === "processed" && pe.linkedInvoiceId && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100"><Link2 className="h-3 w-3 mr-1" />Linked #{pe.linkedInvoiceId}</Badge>}
                            {pe.status === "pending" && <Badge variant="outline" className="text-amber-600">Pending</Badge>}
                            {pe.status === "error" && <Badge variant="destructive">Error</Badge>}
                            {pe.status === "skipped" && <Badge variant="secondary">Skipped</Badge>}
                          </td>
                          <td className="py-2 px-3 max-w-[200px] truncate">{pe.subject}</td>
                          <td className="py-2 px-3 text-muted-foreground">{pe.senderName || pe.senderEmail}</td>
                          <td className="py-2 px-3 font-medium">{pe.extractedSupplier || "—"}</td>
                          <td className="py-2 px-3 text-right font-mono">{pe.extractedAmount ? formatCurrency(Number(pe.extractedAmount)) : "—"}</td>
                          <td className="py-2 px-3">{pe.extractedInvoiceNumber || "—"}</td>
                          <td className="py-2 px-3">{pe.extractedDate || "—"}</td>
                          <td className="py-2 px-3">
                            {pe.fileUrl && (
                              <Button variant="ghost" size="sm" onClick={() => window.open(pe.fileUrl, "_blank")}>
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {pe.linkedInvoiceId ? (
                              <Button variant="outline" size="sm" onClick={() => window.location.href = `/invoices`}>
                                <Eye className="h-3 w-3 mr-1" />
                                View
                              </Button>
                            ) : pe.status === "processed" ? (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => handleCreateInvoice(pe)}
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Create Invoice
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Extract Invoice Confirmation Dialog */}
      <Dialog open={extractDialogOpen} onOpenChange={setExtractDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Extract Invoice Data
            </DialogTitle>
            <DialogDescription>
              AI will analyze the attachment and extract invoice details (supplier, amount, date, line items).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {extractingAttachment && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium">{extractingAttachment.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The document will be uploaded to S3 and analyzed using AI to extract invoice details.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExtractDialogOpen(false)}>Cancel</Button>
              <Button onClick={confirmExtract} disabled={extractMutation.isPending}>
                {extractMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1" />
                    Extract Invoice
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Invoice from Email Dialog */}
      <Dialog open={createInvoiceDialogOpen} onOpenChange={setCreateInvoiceDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="h-5 w-5 text-primary" />
              Create Invoice from Email
            </DialogTitle>
            <DialogDescription>
              Review the extracted data and create an invoice record. The PDF attachment will be automatically linked.
            </DialogDescription>
          </DialogHeader>
          {selectedProcessedEmail && (
            <div className="space-y-4">
              {/* Extracted Data Summary */}
              <div className="p-3 bg-muted rounded-lg space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted from Email</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Subject:</span>
                    <p className="font-medium truncate">{selectedProcessedEmail.subject}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sender:</span>
                    <p className="font-medium">{selectedProcessedEmail.senderName || selectedProcessedEmail.senderEmail}</p>
                  </div>
                  {selectedProcessedEmail.extractedInvoiceNumber && (
                    <div>
                      <span className="text-muted-foreground">Invoice #:</span>
                      <p className="font-medium">{selectedProcessedEmail.extractedInvoiceNumber}</p>
                    </div>
                  )}
                  {selectedProcessedEmail.extractedDate && (
                    <div>
                      <span className="text-muted-foreground">Date:</span>
                      <p className="font-medium">{selectedProcessedEmail.extractedDate}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Editable Fields */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="inv-supplier">Supplier Name</Label>
                  <Input
                    id="inv-supplier"
                    value={invoiceFormSupplier}
                    onChange={(e) => setInvoiceFormSupplier(e.target.value)}
                    placeholder="Supplier name"
                  />
                  {suppliersList && invoiceFormSupplier && (
                    <div className="mt-1">
                      {(() => {
                        const match = suppliersList.find((s: any) =>
                          s.name.toLowerCase().includes(invoiceFormSupplier.toLowerCase()) ||
                          invoiceFormSupplier.toLowerCase().includes(s.name.toLowerCase())
                        );
                        return match ? (
                          <p className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Will match to: {match.name}
                          </p>
                        ) : (
                          <p className="text-xs text-amber-600 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> No matching supplier found — invoice will be created without supplier link
                          </p>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="inv-total">Total Amount (CAD)</Label>
                  <Input
                    id="inv-total"
                    value={invoiceFormTotal}
                    onChange={(e) => setInvoiceFormTotal(e.target.value)}
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                  />
                </div>

                <div>
                  <Label htmlFor="inv-location">Location</Label>
                  <Select value={invoiceFormLocation} onValueChange={setInvoiceFormLocation}>
                    <SelectTrigger id="inv-location">
                      <SelectValue placeholder="Select location (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {locationsList?.map((loc: any) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* File indicator */}
              {selectedProcessedEmail.fileUrl && (
                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-md border border-blue-200">
                  <FileText className="h-4 w-4 text-blue-600" />
                  <span className="text-sm text-blue-700">PDF attachment will be automatically linked to the invoice</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setCreateInvoiceDialogOpen(false)}>Cancel</Button>
                <Button onClick={confirmCreateInvoice} disabled={createInvoiceFromEmailMutation.isPending}>
                  {createInvoiceFromEmailMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1" />
                      Create Invoice
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
