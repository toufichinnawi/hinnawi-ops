import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2, Clock, AlertTriangle, RefreshCw, Bell,
  MoreVertical, Play, SkipForward, Calendar, FileText,
  DollarSign, Building2, Mail, CreditCard, ArrowRightLeft,
  ClipboardCheck, CircleDot, Loader2
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Types ───

type TaskFrequency = "daily" | "weekly" | "monthly";
type TaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "overdue";
type TaskPriority = "critical" | "high" | "medium" | "low";
type TaskCategory = "revenue_posting" | "invoice_processing" | "bank_reconciliation" |
  "payroll" | "tax_filing" | "month_end" | "email_processing" |
  "expense_classification" | "intercompany" | "other";

interface Task {
  id: number;
  taskKey: string;
  frequency: TaskFrequency;
  category: TaskCategory;
  title: string;
  description: string | null;
  locationId: number | null;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  autoDetected: boolean;
  completedBy: string | null;
  completedAt: string | null;
  completionNotes: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

// ─── Helpers ───

function fmt(val: string | Date | null | undefined): string {
  if (!val) return "";
  if (val instanceof Date) return val.toLocaleDateString();
  return String(val);
}

// ─── Constants ───

const LOCATION_NAMES: Record<number, string> = {
  1: "President Kennedy",
  2: "Mackay",
  3: "Ontario",
  4: "Cathcart Tunnel",
  5: "Factory",
};

const CATEGORY_CONFIG: Record<TaskCategory, { icon: typeof DollarSign; label: string; color: string }> = {
  revenue_posting: { icon: DollarSign, label: "Revenue", color: "text-green-600" },
  invoice_processing: { icon: FileText, label: "Invoices", color: "text-blue-600" },
  bank_reconciliation: { icon: Building2, label: "Bank Recon", color: "text-purple-600" },
  payroll: { icon: ClipboardCheck, label: "Payroll", color: "text-orange-600" },
  tax_filing: { icon: FileText, label: "Tax Filing", color: "text-red-600" },
  month_end: { icon: Calendar, label: "Month-End", color: "text-indigo-600" },
  email_processing: { icon: Mail, label: "Email", color: "text-cyan-600" },
  expense_classification: { icon: CreditCard, label: "Expenses", color: "text-amber-600" },
  intercompany: { icon: ArrowRightLeft, label: "Inter-Co", color: "text-teal-600" },
  other: { icon: CircleDot, label: "Other", color: "text-gray-600" },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; variant: "destructive" | "default" | "secondary" | "outline" }> = {
  critical: { label: "Critical", variant: "destructive" },
  high: { label: "High", variant: "default" },
  medium: { label: "Medium", variant: "secondary" },
  low: { label: "Low", variant: "outline" },
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: "Pending", icon: Clock, color: "text-yellow-600" },
  in_progress: { label: "In Progress", icon: Play, color: "text-blue-600" },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-green-600" },
  skipped: { label: "Skipped", icon: SkipForward, color: "text-gray-500" },
  overdue: { label: "Overdue", icon: AlertTriangle, color: "text-red-600" },
};

// ─── Component ───

export default function AccountantTasks() {
  const [activeTab, setActiveTab] = useState<TaskFrequency>("daily");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);

  // ─── Queries ───
  const summaryQuery = trpc.accountantTasks.summary.useQuery();
  const tasksQuery = trpc.accountantTasks.list.useQuery({
    frequency: activeTab,
    status: statusFilter === "active" ? undefined : statusFilter as TaskStatus,
  });

  // ─── Mutations ───
  const detectMutation = trpc.accountantTasks.detect.useMutation({
    onSuccess: (data) => {
      toast.success(`Task scan complete: ${data.new} new, ${data.updated} updated`);
      summaryQuery.refetch();
      tasksQuery.refetch();
      setIsDetecting(false);
    },
    onError: (err) => {
      toast.error(`Detection failed: ${err.message}`);
      setIsDetecting(false);
    },
  });

  const completeMutation = trpc.accountantTasks.complete.useMutation({
    onSuccess: () => {
      toast.success("Task marked as completed");
      setCompleteDialogOpen(false);
      setSelectedTask(null);
      setCompletionNotes("");
      summaryQuery.refetch();
      tasksQuery.refetch();
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const updateStatusMutation = trpc.accountantTasks.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Task status updated");
      summaryQuery.refetch();
      tasksQuery.refetch();
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const notifyMutation = trpc.accountantTasks.notifyOverdue.useMutation({
    onSuccess: (data) => {
      if (data.success) toast.success("Overdue notification sent");
      else toast.info("No overdue tasks to notify about");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  // ─── Auto-detect on mount ───
  useEffect(() => {
    setIsDetecting(true);
    detectMutation.mutate();
  }, []);

  // ─── Handlers ───
  const handleComplete = useCallback((task: Task) => {
    setSelectedTask(task);
    setCompletionNotes("");
    setCompleteDialogOpen(true);
  }, []);

  const handleConfirmComplete = useCallback(() => {
    if (!selectedTask) return;
    completeMutation.mutate({
      taskId: selectedTask.id,
      completedBy: "accountant",
      notes: completionNotes || undefined,
    });
  }, [selectedTask, completionNotes]);

  const handleStartTask = useCallback((task: Task) => {
    updateStatusMutation.mutate({ taskId: task.id, status: "in_progress" });
  }, []);

  const handleSkipTask = useCallback((task: Task) => {
    updateStatusMutation.mutate({ taskId: task.id, status: "skipped", notes: "Skipped by accountant" });
  }, []);

  // ─── Summary Cards ───
  const summary = summaryQuery.data;
  const getCount = (freq: TaskFrequency, status: TaskStatus) =>
    summary?.[freq]?.[status] || 0;
  const getActiveCount = (freq: TaskFrequency) =>
    getCount(freq, "pending") + getCount(freq, "in_progress") + getCount(freq, "overdue");
  const getOverdueCount = (freq: TaskFrequency) => getCount(freq, "overdue");
  const totalOverdue = getOverdueCount("daily") + getOverdueCount("weekly") + getOverdueCount("monthly");
  const totalActive = getActiveCount("daily") + getActiveCount("weekly") + getActiveCount("monthly");

  // ─── Filter tasks ───
  const tasks = (tasksQuery.data || []) as Task[];
  const filteredTasks = statusFilter === "active"
    ? tasks.filter(t => ["pending", "in_progress", "overdue"].includes(t.status))
    : tasks;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accountant Task Center</h1>
          <p className="text-muted-foreground">
            Auto-detected tasks from data gaps and bookkeeping requirements
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => notifyMutation.mutate()}
            disabled={notifyMutation.isPending || totalOverdue === 0}
          >
            <Bell className="h-4 w-4 mr-1" />
            Notify Overdue ({totalOverdue})
          </Button>
          <Button
            size="sm"
            onClick={() => { setIsDetecting(true); detectMutation.mutate(); }}
            disabled={isDetecting}
          >
            {isDetecting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Scan for Tasks
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Active</p>
                <p className="text-3xl font-bold">{totalActive}</p>
              </div>
              <ClipboardCheck className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className={totalOverdue > 0 ? "border-red-300 bg-red-50 dark:bg-red-950/20" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Overdue</p>
                <p className="text-3xl font-bold text-red-600">{totalOverdue}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed Today</p>
                <p className="text-3xl font-bold text-green-600">
                  {tasks.filter(t => t.status === "completed" && t.completedAt &&
                    new Date(t.completedAt).toDateString() === new Date().toDateString()
                  ).length}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">In Progress</p>
                <p className="text-3xl font-bold text-blue-600">
                  {getCount("daily", "in_progress") + getCount("weekly", "in_progress") + getCount("monthly", "in_progress")}
                </p>
              </div>
              <Play className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Frequency Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TaskFrequency)}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="daily" className="gap-1">
              Daily
              {getActiveCount("daily") > 0 && (
                <Badge variant={getOverdueCount("daily") > 0 ? "destructive" : "secondary"} className="ml-1 text-xs px-1.5">
                  {getActiveCount("daily")}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="weekly" className="gap-1">
              Weekly
              {getActiveCount("weekly") > 0 && (
                <Badge variant={getOverdueCount("weekly") > 0 ? "destructive" : "secondary"} className="ml-1 text-xs px-1.5">
                  {getActiveCount("weekly")}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="monthly" className="gap-1">
              Monthly
              {getActiveCount("monthly") > 0 && (
                <Badge variant={getOverdueCount("monthly") > 0 ? "destructive" : "secondary"} className="ml-1 text-xs px-1.5">
                  {getActiveCount("monthly")}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Status Filter */}
          <div className="flex gap-1">
            {[
              { value: "active", label: "Active" },
              { value: "completed", label: "Completed" },
              { value: "skipped", label: "Skipped" },
            ].map(f => (
              <Button
                key={f.value}
                variant={statusFilter === f.value ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Task Lists */}
        {(["daily", "weekly", "monthly"] as TaskFrequency[]).map(freq => (
          <TabsContent key={freq} value={freq} className="space-y-3 mt-4">
            {tasksQuery.isLoading ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                  Loading tasks...
                </CardContent>
              </Card>
            ) : filteredTasks.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {statusFilter === "active"
                    ? `No active ${freq} tasks. All caught up!`
                    : `No ${statusFilter} ${freq} tasks.`}
                </CardContent>
              </Card>
            ) : (
              filteredTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onComplete={handleComplete}
                  onStart={handleStartTask}
                  onSkip={handleSkipTask}
                />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Complete Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Task</DialogTitle>
            <DialogDescription>
              {selectedTask?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Completion Notes (optional)</label>
              <Textarea
                placeholder="Add any notes about how this task was completed..."
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmComplete} disabled={completeMutation.isPending}>
              {completeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Mark Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Task Card Component ───

function TaskCard({
  task,
  onComplete,
  onStart,
  onSkip,
}: {
  task: Task;
  onComplete: (task: Task) => void;
  onStart: (task: Task) => void;
  onSkip: (task: Task) => void;
}) {
  const catConfig = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.other;
  const prioConfig = PRIORITY_CONFIG[task.priority];
  const statusConfig = STATUS_CONFIG[task.status];
  const CategoryIcon = catConfig.icon;
  const StatusIcon = statusConfig.icon;
  const isActionable = task.status !== "completed" && task.status !== "skipped";

  return (
    <Card className={
      task.status === "overdue" ? "border-red-300 dark:border-red-800" :
      task.status === "completed" ? "opacity-60" :
      task.status === "in_progress" ? "border-blue-300 dark:border-blue-800" : ""
    }>
      <CardContent className="py-4">
        <div className="flex items-start gap-4">
          {/* Category Icon */}
          <div className={`mt-0.5 ${catConfig.color}`}>
            <CategoryIcon className="h-5 w-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`font-medium ${task.status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                {task.title}
              </h3>
              <Badge variant={prioConfig.variant} className="text-xs">
                {prioConfig.label}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {catConfig.label}
              </Badge>
              {task.locationId && (
                <Badge variant="outline" className="text-xs">
                  {LOCATION_NAMES[task.locationId] || `Loc #${task.locationId}`}
                </Badge>
              )}
            </div>

            {task.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {task.description}
              </p>
            )}

            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className={`flex items-center gap-1 ${statusConfig.color}`}>
                <StatusIcon className="h-3.5 w-3.5" />
                {statusConfig.label}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Due: {fmt(task.dueDate)}
              </span>
              {task.periodStart && task.periodEnd && (
                <span>Period: {fmt(task.periodStart)} to {fmt(task.periodEnd)}</span>
              )}
              {task.completedBy && (
                <span className="text-green-600">
                  Completed by {task.completedBy} on {fmt(task.completedAt)}
                </span>
              )}
              {task.autoDetected && (
                <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-950/30">
                  Auto-detected
                </Badge>
              )}
            </div>

            {task.completionNotes && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Note: {task.completionNotes}
              </p>
            )}
          </div>

          {/* Actions */}
          {isActionable && (
            <div className="flex items-center gap-1">
              {task.status === "pending" && (
                <Button variant="outline" size="sm" onClick={() => onStart(task)}>
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Start
                </Button>
              )}
              <Button variant="default" size="sm" onClick={() => onComplete(task)}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Done
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onSkip(task)}>
                    <SkipForward className="h-4 w-4 mr-2" />
                    Skip
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
