"""Connector boundary tests using actual PostgreSQL roles and transactions."""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from threading import Barrier
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
from psycopg import errors
import pytest
from persistence.measurement import load_measurement_input

DSN = os.environ.get('CAUSENT_TEST_DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')

@contextmanager
def connection(role='postgres', actor=None):
    with psycopg.connect(DSN) as conn:
        if role != 'postgres':
            conn.execute('set local role ' + ('causent_ga4_worker' if role == 'causent_ga4_worker' else 'authenticated'))
        conn.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({'role': role, **({'sub':str(actor)} if actor else {})}),))
        yield conn

@pytest.fixture
def fixture():
    org, project, scope, other_org, other_project, other_scope = [uuid4() for _ in range(6)]
    actors = {role: uuid4() for role in ('owner','admin','member','viewer','outsider')}
    with connection() as conn:
        for actor in actors.values(): conn.execute('insert into auth.users(id) values(%s)', (actor,))
        for o,p,s in ((org,project,scope),(other_org,other_project,other_scope)):
            conn.execute("insert into public.orgs(org_id,name) values(%s,'GA4_TEST')", (o,))
            conn.execute("insert into public.projects(project_id,org_id,name) values(%s,%s,'GA4_TEST')", (p,o))
            conn.execute("insert into public.workspaces(workspace_id,project_id,name) values(%s,%s,'GA4_TEST')", (s,p))
        for role,actor in actors.items():
            conn.execute('insert into public.memberships(user_id,org_id,role) values(%s,%s,%s)', (actor,other_org if role=='outsider' else org,'owner' if role=='outsider' else role))
    f = dict(scope=scope, other_scope=other_scope, actors=actors)
    yield f
    with connection() as conn:
        conn.execute('delete from public.orgs where org_id=any(%s)', ([org,other_org],))
        conn.execute('delete from auth.users where id=any(%s)', (list(actors.values()),))


def manage(f, action, cid=None, payload=None, actor='owner', scope=None):
    with connection('authenticated',f['actors'][actor]) as conn:
        return conn.execute('select public.ga4_manage_v1(%s,%s,%s,%s::jsonb)', (action,scope or f['scope'],cid,json.dumps(payload or {}))).fetchone()[0]


def worker(action,payload):
    with connection('causent_ga4_worker') as conn:
        return conn.execute('select public.ga4_worker_v1(%s,%s::jsonb)', (action,json.dumps(payload,default=str))).fetchone()[0]


def authorized(f):
    state=hashlib.sha256(uuid4().bytes).hexdigest()
    cid=manage(f,'begin',payload={'stateHash':state})['connectionId']
    payload={'stateHash':state,'actorId':f['actors']['owner'],'subject':'google-subject','refreshCipher':'v1.'+'x'*100}
    worker('oauth',payload)
    return cid,payload


def lease(f,cid):
    return worker('lease',{'connectionId':cid,'scopeId':f['scope'],'actorId':f['actors']['owner']})


def bound(value):
    return {'connectionId':value['connection']['connection_id'],'leaseId':value['leaseId'],'generation':value['connection']['generation']}


def configured(f,metrics=None):
    cid,_=authorized(f)
    value=lease(f,cid)
    worker('configure',{**bound(value),'propertyId':'12345','propertyName':'Test property','timezone':'America/Los_Angeles',
        'metrics':metrics or [{'metric':'sessions','event':'','direction':'higher'}]})
    return cid


def report(value=10,quality=None):
    end=datetime.now(ZoneInfo('America/Los_Angeles')).date()-timedelta(days=1)
    start=end-timedelta(days=2)
    return {'start':str(start),'end':str(end),'timezone':'America/Los_Angeles','rowCount':2,'missingDays':1,
      'observations':[{'date':str(start),'value':value},{'date':str(end),'value':0}],
      'quality':quality or dict(thresholded=False,sampled=False,otherRow=False,restricted=False),
      'fetchedAt':datetime.now(timezone.utc).isoformat()}


def publish(value,data=None):
    return worker('publish',{**bound(value),'reports':[{'mappingId':value['mappings'][0]['mapping_id'],'report':data or report()}]})


def test_admin_authorization_and_worker_acl(fixture):
    f=fixture
    for role in ('member','viewer','outsider'):
        with pytest.raises(errors.InsufficientPrivilege): manage(f,'begin',payload={'stateHash':'a'*64},actor=role)
    manage(f,'begin',payload={'stateHash':hashlib.sha256(uuid4().bytes).hexdigest()},actor='admin')
    cid,_=authorized(f)
    with connection('authenticated',f['actors']['outsider']) as conn:
        assert conn.execute('select count(*) from public.ga4_connections where connection_id=%s',(cid,)).fetchone()[0]==0
    for role in ('authenticated','causent_ga4_worker'):
        with pytest.raises(errors.InsufficientPrivilege):
            with connection(role,f['actors']['owner']) as conn: conn.execute('select * from private.ga4_credentials')
    with pytest.raises(errors.InsufficientPrivilege):
        with connection('authenticated',f['actors']['owner']) as conn: conn.execute("select public.ga4_worker_v1('claim','{}')")
    with pytest.raises(errors.InsufficientPrivilege):
        with connection('causent_ga4_worker') as conn: conn.execute('select * from public.metric_observations')
    with pytest.raises(errors.InsufficientPrivilege):
        worker('lease',{'connectionId':cid,'scopeId':f['other_scope'],'actorId':f['actors']['outsider']})


def test_state_replay_actor_substitution_and_refresh_preservation(fixture):
    f=fixture
    cid,payload=authorized(f)
    with pytest.raises(errors.InsufficientPrivilege): worker('oauth',payload)
    state=hashlib.sha256(uuid4().bytes).hexdigest()
    manage(f,'begin',cid,{'stateHash':state})
    with pytest.raises(errors.InsufficientPrivilege): worker('oauth',{**payload,'stateHash':state,'actorId':f['actors']['outsider']})
    with pytest.raises(errors.InvalidParameterValue): worker('oauth',{**payload,'stateHash':state,'refreshCipher':None,'subject':'different-account'})
    worker('oauth',{**payload,'stateHash':state,'refreshCipher':None})
    assert lease(f,cid)['refreshCipher']==payload['refreshCipher']


def test_atomic_publish_idempotency_core_selection_and_analysis_provenance(fixture):
    f=fixture
    cid=configured(f)
    value=lease(f,cid)
    assert publish(value)=={'connectionId':cid}
    assert publish(value)=={'reused':True}
    metric=value['mappings'][0]['metric_id']
    with connection('authenticated',f['actors']['owner']) as conn:
        rows=conn.execute('select obs_date,value from public.metric_observations where metric_id=%s order by obs_date',(metric,)).fetchall()
        assert len(rows)==2 and rows[0][1]==10 and rows[1][1]==0
        definition=conn.execute('select timezone,aggregation from public.metric_definitions where metric_id=%s',(metric,)).fetchone()
        assert definition==('America/Los_Angeles','sum')
        assert conn.execute('select count(*) from public.ga4_sync_receipts').fetchone()[0]==1
        inputs=load_measurement_input(conn,f['scope'],metric,None)
        assert inputs.refusal=='MEASUREMENT_PLAN_REQUIRED'
        assert inputs.manifest['ga4_provenance']['receipt']['row_count']==2
        assert inputs.manifest['ga4_provenance']['property_id']=='12345'
        conn.execute('select public.set_workspace_core_metric_v1(%s,%s,true,%s)',(f['scope'],metric,f['actors']['owner']))
    with pytest.raises(errors.InsufficientPrivilege):
        with connection('authenticated',f['actors']['owner']) as conn:
            conn.execute('update public.metric_observations set value=999 where metric_id=%s',(metric,))


def test_bad_batch_rolls_back_and_quality_withholds_analysis(fixture):
    f=fixture
    cid=configured(f)
    value=lease(f,cid)
    bad=report(); bad['observations'][0]['value']=-1
    with pytest.raises(errors.InvalidParameterValue): publish(value,bad)
    with connection() as conn:
        assert conn.execute('select count(*) from public.ga4_sync_receipts where scope_id=%s',(f['scope'],)).fetchone()[0]==0
    restricted=report(quality=dict(thresholded=True,sampled=False,otherRow=False,restricted=False))
    publish(value,restricted)
    metric=value['mappings'][0]['metric_id']
    with connection('authenticated',f['actors']['owner']) as conn:
        assert conn.execute('select count(*) from public.metric_observations where metric_id=%s',(metric,)).fetchone()[0]==0
        assert load_measurement_input(conn,f['scope'],metric,None).refusal=='GA4_QUALITY_RESTRICTED'


def test_disconnect_and_removed_membership_reject_inflight_writes(fixture):
    f=fixture
    cid=configured(f); value=lease(f,cid)
    manage(f,'disconnect',cid)
    with pytest.raises(errors.InsufficientPrivilege): publish(value)
    with connection() as conn: assert conn.execute('select count(*) from private.ga4_credentials where connection_id=%s',(cid,)).fetchone()[0]==0
    cid=configured(f); value=lease(f,cid)
    with connection() as conn: conn.execute('delete from public.memberships where user_id=%s',(f['actors']['owner'],))
    with pytest.raises(errors.InsufficientPrivilege): publish(value)


def test_expired_lease_and_property_changes_are_rejected(fixture):
    f=fixture
    cid=configured(f); value=lease(f,cid)
    with pytest.raises(errors.LockNotAvailable): lease(f,cid)
    with pytest.raises(errors.InvalidParameterValue):
        worker('configure',{**bound(value),'propertyId':'999','propertyName':'Other','timezone':'UTC','metrics':[{'metric':'sessions','event':'','direction':'higher'}]})
    with connection() as conn: conn.execute("update private.ga4_credentials set lease_until=now()-interval '1 second' where connection_id=%s",(cid,))
    newer=lease(f,cid)
    with pytest.raises(errors.SerializationFailure): publish(value)
    publish(newer)


def test_complete_revisions_remove_missing_rows_without_zeros(fixture):
    f=fixture
    cid=configured(f); first=lease(f,cid); publish(first)
    revised=report(20); revised['observations']=revised['observations'][:1]; revised['rowCount']=1; revised['missingDays']=2
    second=lease(f,cid); publish(second,revised)
    metric=first['mappings'][0]['metric_id']
    with connection() as conn:
        rows=conn.execute('select value from public.metric_observations where metric_id=%s',(metric,)).fetchall()
        assert rows==[(20,)]
        assert conn.execute('select count(distinct content_hash) from public.ga4_sync_receipts where scope_id=%s',(f['scope'],)).fetchone()[0]==2


def test_live_health_withholds_stale_data_and_changed_generation(fixture):
    f=fixture; cid=configured(f); value=lease(f,cid); publish(value)
    metric=value['mappings'][0]['metric_id']
    with connection('authenticated',f['actors']['owner']) as conn:
        assert conn.execute('select reason from public.ga4_metric_health where metric_id=%s',(metric,)).fetchone()[0] is None
    stale=report()
    stale['start']=str(datetime.fromisoformat(stale['start']).date()-timedelta(days=10))
    stale['end']=str(datetime.fromisoformat(stale['end']).date()-timedelta(days=10))
    stale['observations']=[{'date':stale['start'],'value':1},{'date':stale['end'],'value':2}]
    publish(lease(f,cid),stale)
    with connection('authenticated',f['actors']['owner']) as conn:
        assert conn.execute('select reason from public.ga4_metric_health where metric_id=%s',(metric,)).fetchone()[0]=='GA4_DATA_STALE'
        assert load_measurement_input(conn,f['scope'],metric,None).refusal=='GA4_DATA_STALE'
    manage(f,'begin',cid,{'stateHash':hashlib.sha256(uuid4().bytes).hexdigest()})
    with connection('authenticated',f['actors']['owner']) as conn:
        assert conn.execute('select reason from public.ga4_metric_health where metric_id=%s',(metric,)).fetchone()[0]=='GA4_SYNC_REQUIRED'


def test_archival_and_provider_identity_tampering_are_denied(fixture):
    f=fixture; cid=configured(f); value=lease(f,cid); publish(value)
    metric=value['mappings'][0]['metric_id']
    with pytest.raises(errors.InsufficientPrivilege):
        with connection('authenticated',f['actors']['owner']) as conn:
            conn.execute("update public.metrics set source='csv' where metric_id=%s",(metric,))
    with connection() as conn: conn.execute('update public.workspaces set archived_at=now() where workspace_id=%s',(f['scope'],))
    with pytest.raises(errors.InsufficientPrivilege): lease(f,cid)
    with connection('authenticated',f['actors']['owner']) as conn:
        assert conn.execute('select reason from public.ga4_metric_health where metric_id=%s',(metric,)).fetchone()[0]=='GA4_SYNC_REQUIRED'


def test_another_admin_can_disconnect_after_original_authorizer_loses_access(fixture):
    f=fixture; cid=configured(f)
    with connection() as conn: conn.execute('delete from public.memberships where user_id=%s',(f['actors']['owner'],))
    result=worker('disconnect',{'connectionId':cid,'scopeId':f['scope'],'actorId':f['actors']['admin']})
    assert result['refreshCipher'].startswith('v1.')
    with connection() as conn:
        assert conn.execute('select count(*) from private.ga4_credentials where connection_id=%s',(cid,)).fetchone()[0]==0


def test_missing_lease_cannot_publish_or_release(fixture):
    f=fixture; cid=configured(f)
    with pytest.raises(errors.SerializationFailure):
        worker('release',{'connectionId':cid,'generation':1})
    current=lease(f,cid)
    with pytest.raises(errors.SerializationFailure):
        worker('publish',{**bound(current),'leaseId':None,'reports':[]})
    publish(current)


def test_concurrent_claims_take_distinct_connections(fixture):
    f=fixture; ids={configured(f),configured(f)}
    barrier=Barrier(2)
    def claim():
        barrier.wait(timeout=10)
        return worker('claim',{})
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims=list(pool.map(lambda _: claim(),range(2)))
    assert {value['connection']['connection_id'] for value in claims}==ids
    assert worker('claim',{}) is None
    for value in claims: publish(value)


def test_invalid_second_metric_rolls_back_entire_batch(fixture):
    f=fixture; cid=configured(f,[{'metric':metric,'direction':'higher'} for metric in ('sessions','engagedSessions')])
    value=lease(f,cid)
    reports=[{'mappingId':m['mapping_id'],'report':report()} for m in value['mappings']]
    reports[1]['report']['observations'][0]['value']=-1
    with pytest.raises(errors.InvalidParameterValue): worker('publish',{**bound(value),'reports':reports})
    with connection() as conn:
        assert conn.execute('select count(*) from public.ga4_sync_receipts where scope_id=%s',(f['scope'],)).fetchone()[0]==0
        assert conn.execute('select count(*) from public.metric_observations o join public.metrics m using(metric_id) where m.scope_id=%s',(f['scope'],)).fetchone()[0]==0


def test_existing_readout_is_withheld_after_revision_and_disconnect(fixture):
    f=fixture; cid=configured(f); value=lease(f,cid); publish(value)
    metric=value['mappings'][0]['metric_id']
    action,source,target,evaluation,edge=[uuid4() for _ in range(5)]
    with connection() as conn:
        receipt=conn.execute('select last_receipt_id from public.ga4_metric_mappings where metric_id=%s',(metric,)).fetchone()[0]
        manifest={'ga4_provenance':{'receipt':{'receipt_id':str(receipt)}}}
        conn.execute("insert into public.actions(action_id,scope_id,source) values(%s,%s,'manual')",(action,f['scope']))
        conn.execute("insert into public.nodes(node_id,scope_id,type,semantic_ref) values(%s,%s,'ACTION',%s),(%s,%s,'METRIC',%s)",(source,f['scope'],action,target,f['scope'],metric))
        conn.execute("insert into public.evaluation_runs(evaluation_id,scope_id,metric_id,actor_id,input_manifest,input_hash,model_version) values(%s,%s,%s,%s,%s::jsonb,%s,'ga4-gate-test')",(evaluation,f['scope'],metric,f['actors']['owner'],json.dumps(manifest),'a'*64))
        conn.execute("insert into public.causal_edges(edge_id,scope_id,source_node_id,target_node_id,direction,belief_score,authoritative_method,evaluation_id) values(%s,%s,%s,%s,'POSITIVE',0.8,'ITS',%s)",(edge,f['scope'],source,target,evaluation))
        conn.execute("insert into public.evidence_objects(scope_id,edge_id,action_id,methodology,lift) values(%s,%s,%s,'ITS',12)",(f['scope'],edge,action))
    def read():
        with connection('authenticated',f['actors']['viewer']) as conn:
            return conn.execute('select direction,lift,refusal_reason from public.current_edge_readouts where edge_id=%s',(edge,)).fetchone()
    assert read()==('POSITIVE',12,None)
    publish(lease(f,cid),report(20))
    assert read()==('INCONCLUSIVE',None,'GA4_ANALYSIS_PENDING')
    manage(f,'disconnect',cid)
    assert read()==('INCONCLUSIVE',None,'GA4_SYNC_REQUIRED')
    with connection('authenticated',f['actors']['outsider']) as conn:
        assert conn.execute('select count(*) from public.ga4_metric_health where metric_id=%s',(metric,)).fetchone()[0]==0
