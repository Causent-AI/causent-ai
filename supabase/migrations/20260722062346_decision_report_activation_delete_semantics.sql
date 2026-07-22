-- Remove the circular report -> activation -> report FK chain. The activation
-- row remains the authoritative, fully-constrained audit record; report
-- pointer UUIDs are a denormalized read optimization populated only by the
-- checked activation RPC. Cascades preserve the repository's existing
-- workspace/org teardown behavior for service administrators.

alter table public.decision_reports
  drop constraint decision_reports_active_activation_id_fkey,
  drop constraint decision_reports_active_decision_id_fkey,
  drop constraint decision_reports_active_prediction_id_fkey,
  drop constraint decision_reports_active_metric_id_fkey;

alter table public.decision_report_activations
  drop constraint decision_report_activations_metric_id_fkey,
  drop constraint decision_report_activations_decision_id_fkey,
  drop constraint decision_report_activations_prediction_id_fkey,
  drop constraint decision_report_activations_report_id_scope_id_fkey,
  drop constraint decision_report_activations_report_id_revision_id_fkey;

alter table public.decision_report_activations
  add constraint decision_report_activations_metric_id_fkey
    foreign key (metric_id) references public.metrics(metric_id) on delete cascade,
  add constraint decision_report_activations_decision_id_fkey
    foreign key (decision_id) references public.decisions(decision_id) on delete cascade,
  add constraint decision_report_activations_prediction_id_fkey
    foreign key (prediction_id) references public.predictions(prediction_id) on delete cascade,
  add constraint decision_report_activations_report_id_scope_id_fkey
    foreign key (report_id, scope_id)
    references public.decision_reports(report_id, scope_id) on delete cascade,
  add constraint decision_report_activations_report_id_revision_id_fkey
    foreign key (report_id, revision_id)
    references public.decision_report_revisions(report_id, revision_id) on delete cascade;
