'use client';

import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { AuditLog } from '@/types';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_ACTION_COLORS } from '@/lib/audit-actions';

const ALL = 'all';

export default function AuditLogsView() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState(ALL);
  const [entityFilter, setEntityFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  // Debounced mirror of `search`: without it every keystroke fired a request,
  // and whichever response landed last won, so the list could show results for
  // a prefix the user had already deleted.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const current = ++requestId.current;

    async function fetchLogs() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (actionFilter !== ALL) params.set('action', actionFilter);
        if (entityFilter !== ALL) params.set('entity', entityFilter);
        if (debouncedSearch) params.set('search', debouncedSearch);
        const res = await fetch(`/api/audit-logs?${params.toString()}`);
        if (current !== requestId.current) return;
        if (res.ok) {
          const data = await res.json();
          if (current !== requestId.current) return;
          setLogs(data.logs ?? []);
        } else if (current === requestId.current) {
          setLogs([]);
        }
      } catch { /* silent */ }
      if (current === requestId.current) setLoading(false);
    }

    fetchLogs();
  }, [actionFilter, entityFilter, debouncedSearch]);

  return (
    <div className="space-y-4 p-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Actions</SelectItem>
              {/* The real logged actions. The previous list offered SALE,
                  PURCHASE, STOCK, USER and SETTINGS, none of which is ever
                  written, so the filter always came back empty. */}
              {AUDIT_ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Entities</SelectItem>
              {AUDIT_ENTITIES.map((entity) => (
                <SelectItem key={entity} value={entity}>
                  {entity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    </TableRow>
                  ))
                ) : logs.length > 0 ? (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString('en-GH')}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {/* null user = the account was deleted; the audit row
                            is kept on purpose, so say so instead of '-'. */}
                        {log.user?.name ?? 'Deleted user'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            AUDIT_ACTION_COLORS[log.action as keyof typeof AUDIT_ACTION_COLORS]
                            ?? 'border-gray-300 text-gray-700 bg-gray-50'
                          }
                        >
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.entity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                        {log.details ?? '-'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                      No audit logs found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
