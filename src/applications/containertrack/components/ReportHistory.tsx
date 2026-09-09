import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContainerReportRow } from "../types";

export interface ReportHistoryProps {
  reports: ContainerReportRow[];
  onView: (report: ContainerReportRow) => void;
  onPrint: (report: ContainerReportRow) => void;
}

export function ReportHistory({ reports, onView, onPrint }: ReportHistoryProps) {
  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">No reports yet. Track a container to generate your first report.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {reports.map((report) => (
        <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-[200px]">
            <p className="font-mono text-sm">{report.container_number}</p>
            <p className="text-xs text-muted-foreground">
              {report.report_id} · {new Date(report.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={report.verified ? "default" : "destructive"}>
              {report.verified ? "Verified" : "Unverified"}
            </Badge>
            <Badge variant="outline">{report.status.replace(/_/g, " ")}</Badge>
            <Button size="sm" variant="outline" onClick={() => onView(report)}>
              View
            </Button>
            <Button size="sm" variant="outline" onClick={() => onPrint(report)}>
              Print / PDF
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/verify/$reportId" params={{ reportId: report.report_id }} target="_blank">
                Verify
              </Link>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
