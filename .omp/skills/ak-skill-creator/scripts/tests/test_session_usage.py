import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import session_usage  # noqa: E402


def ts(second):
    return f'2026-09-01T10:00:{second:02d}.000Z'


def assistant(second, msg_id, blocks, usage=None, **extra):
    usage = usage or {'input_tokens': 1, 'cache_read_input_tokens': 100, 'cache_creation_input_tokens': 5,
                      'output_tokens': 20, 'output_tokens_details': {'thinking_tokens': 4}}
    return {'type': 'assistant', 'timestamp': ts(second), 'sessionId': 'sess-claude-1', 'entrypoint': 'cli',
            'message': {'id': msg_id, 'model': 'main-model', 'content': blocks, 'usage': usage}, **extra}


def user(second, content, **extra):
    return {'type': 'user', 'timestamp': ts(second), 'sessionId': 'sess-claude-1', 'message': {'role': 'user', 'content': content}, **extra}


def tool_use(tool_id, name, data):
    return {'type': 'tool_use', 'id': tool_id, 'name': name, 'input': data}


def result(tool_id, is_error=False):
    return [{'type': 'tool_result', 'tool_use_id': tool_id, 'content': 'ok', 'is_error': is_error}]


def write_jsonl(path, events):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(e) + '\n' for e in events), encoding='utf-8')


class SessionUsageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        skill = self.root / 'skills' / 'ak-demo-skill'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: ak:demo-skill\nargument-hint: "<audit|optimize> [path]"\n---\n', encoding='utf-8')
        self.sid = session_usage.SkillId(str(skill))

    def tearDown(self):
        self.tmp.cleanup()

    def claude_fixture(self):
        guide = {'file_path': '/home/u/.claude/skills/ak-demo-skill/references/guide.md'}
        path = self.root / 'claude' / 'proj' / 'sess-claude-1.jsonl'
        write_jsonl(path, [
            user(0, '<command-message>ak-demo-skill</command-message>\n<command-name>/ak-demo-skill</command-name>\n<command-args>audit the thing</command-args>'),
            user(0, [{'type': 'text', 'text': 'Base directory for this skill'}], isMeta=True),
            assistant(1, 'm1', [tool_use('t1', 'Read', guide)]),
            user(3, result('t1')),
            assistant(4, 'm2', [tool_use('t2', 'Bash', {'command': 'python C:\\s\\ak-demo-skill\\scripts\\run.py\\n'})]),
            user(10, result('t2', is_error=True)),
            assistant(11, 'm2', [tool_use('t3', 'Read', guide)]),
            user(12, result('t3')),
            assistant(13, 'm3', [tool_use('t4', 'Agent', {'subagent_type': 'scout', 'model': 'small', 'prompt': 'x'})]),
            user(40, result('t4')),
            user(41, [{'type': 'text', 'text': '[Request interrupted by user]'}]),
            user(50, 'thanks, now something else'),
            assistant(51, 'm4', [tool_use('t5', 'Read', {'file_path': 'x'})]),
        ])
        write_jsonl(path.with_suffix('') / 'subagents' / 'agent-a.jsonl', [
            {'type': 'assistant', 'timestamp': ts(15), 'isSidechain': True,
             'message': {'id': 's1', 'model': 'small-model', 'content': [], 'usage': {'input_tokens': 2, 'output_tokens': 7}}},
        ])
        return path

    def test_claude_slash_invocation_metrics(self):
        records = list(session_usage.claude_invocations(self.claude_fixture(), self.sid))
        self.assertEqual(len(records), 1)
        r = records[0]
        self.assertEqual((r['trigger'], r['subcommand'], r['entrypoint'], r['session']), ('user', 'audit', 'cli', 'sess-cla'))
        self.assertEqual(r['turns'], 3)
        self.assertEqual(r['tokens'], {'input': 3, 'cache_read': 300, 'cache_write': 15, 'output': 60, 'reasoning': 12})
        self.assertEqual((r['tool_calls'], r['tool_errors'], r['duplicate_calls'], r['interruptions']), (4, 1, 1, 1))
        self.assertEqual(r['errors_by_tool'], {'Bash': 1})
        self.assertEqual(r['skill_files'], {'references/guide.md': 2, 'scripts/run.py': 1})
        self.assertEqual(r['delegations'], {'scout@small': 1})
        self.assertEqual(r['subagent']['runs'], 1)
        self.assertEqual(r['subagent']['tokens']['output'], 7)
        self.assertEqual(r['subagent']['models'], {'small-model': 1})
        self.assertEqual(r['duration_s'], 40.0)
        self.assertEqual(r['tool_latency_s']['Agent'], 27.0)

    def test_claude_compaction_and_injected_events_do_not_end_span(self):
        path = self.root / 'claude' / 'p' / 'c.jsonl'
        write_jsonl(path, [
            user(0, '<command-name>/ak-demo-skill</command-name>\n<command-args>optimize x</command-args>'),
            assistant(1, 'm1', [tool_use('t1', 'Read', {'file_path': 'a'})]),
            user(2, 'This session is being continued from a previous conversation.', isCompactSummary=True),
            user(3, '<ci-monitor-event>checks green</ci-monitor-event>'),
            assistant(4, 'm2', [tool_use('t2', 'Read', {'file_path': 'b'})]),
            assistant(4, 's1', [], {'output_tokens': 9}, isSidechain=True),
            assistant(4, 's1', [], {'output_tokens': 9}, isSidechain=True),
            user(5, 'done'),
        ])
        [r] = session_usage.claude_invocations(path, self.sid)
        self.assertEqual((r['turns'], r['tool_calls'], r['subagent']['tokens']['output']), (2, 2, 9))

    def test_claude_plugin_namespaced_slash_command(self):
        path = self.root / 'claude' / 'p' / 'n.jsonl'
        write_jsonl(path, [
            user(0, '<command-name>/ak-core:ak-demo-skill</command-name>\n<command-args>audit x</command-args>'),
            user(1, '<command-name>/ak-core:ak-demo-skill-extra</command-name>'),
        ])
        records = list(session_usage.claude_invocations(path, self.sid))
        self.assertEqual([(r['trigger'], r['subcommand']) for r in records], [('user', 'audit')])

    def test_claude_model_invocation_and_foreign_skill(self):
        path = self.root / 'claude' / 'p' / 's.jsonl'
        write_jsonl(path, [
            user(0, 'please improve the skill'),
            assistant(1, 'm1', [tool_use('t1', 'Skill', {'skill': 'ak-demo-skill', 'args': 'optimize kits/x'})]),
            user(2, result('t1')),
            assistant(3, 'm2', [tool_use('t2', 'Skill', {'skill': 'ak-other'})]),
            assistant(4, 'm3', [tool_use('t3', 'Skill', {'skill': 'plugin:ak-demo-skill-extra'})]),
        ])
        records = list(session_usage.claude_invocations(path, self.sid))
        self.assertEqual([(r['trigger'], r['subcommand']) for r in records], [('model', 'optimize')])
        self.assertEqual(records[0]['skills_chained'], {'ak-other': 1, 'plugin:ak-demo-skill-extra': 1})

    def test_codex_invocation_uses_token_deltas_and_exit_codes(self):
        path = self.root / 'codex' / '2026' / 'rollout-1.jsonl'

        def item(second, payload, kind='response_item'):
            return {'timestamp': ts(second), 'type': kind, 'payload': payload}

        def tokens(second, inp, cached, out, reasoning=0):
            return item(second, {'type': 'token_count', 'info': {'total_token_usage': {
                'input_tokens': inp, 'cached_input_tokens': cached, 'output_tokens': out, 'reasoning_output_tokens': reasoning}}}, 'event_msg')

        def message(second, text):
            return item(second, {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}]})

        write_jsonl(path, [
            item(0, {'id': 'codex-session-9', 'originator': 'codex_exec'}, 'session_meta'),
            item(0, {'model': 'm-x', 'effort': 'low'}, 'turn_context'),
            message(0, '<environment_context>ak-demo-skill listed here</environment_context>'),
            tokens(1, 100, 50, 10),
            message(2, 'use $ak-demo-skill audit now'),
            item(3, {'type': 'function_call', 'name': 'exec_command', 'call_id': 'c1',
                     'arguments': json.dumps({'cmd': 'cat ~/.agents/skills/ak-demo-skill/SKILL.md'})}),
            item(4, {'type': 'function_call_output', 'call_id': 'c1', 'output': 'Exit code: 0'}),
            item(5, {'type': 'custom_tool_call', 'name': 'exec', 'call_id': 'c2',
                     'input': 'read("D:\\\\k\\\\ak-demo-skill\\\\references\\\\guide.md\\n")'}),
            item(9, {'type': 'custom_tool_call_output', 'call_id': 'c2', 'output': [{'type': 'input_text', 'text': 'Script error:\nExit code: 2'}]}),
            tokens(10, 300, 150, 40, 5),
            message(11, 'next task'),
            tokens(12, 900, 150, 90),
        ])
        records = list(session_usage.codex_invocations(path, self.sid))
        self.assertEqual(len(records), 1)
        r = records[0]
        self.assertEqual((r['trigger'], r['subcommand'], r['entrypoint'], r['effort']), ('user', 'audit', 'codex_exec', 'low'))
        self.assertEqual(r['tokens'], {'input': 100, 'cache_read': 100, 'cache_write': 0, 'output': 30, 'reasoning': 5})
        self.assertEqual((r['tool_calls'], r['tool_errors'], r['errors_by_tool']), (2, 1, {'exec': 1}))
        self.assertEqual(r['skill_files'], {'SKILL.md': 1, 'references/guide.md': 1})
        self.assertEqual(r['models'], {'m-x': 2})
        self.assertEqual(r['turns'], 2)
        self.assertEqual(r['duration_s'], 7.0)

    def test_codex_ignores_injected_context_and_reads_current_exit_formats(self):
        path = self.root / 'codex' / 'rollout-2.jsonl'

        def item(second, payload, kind='response_item'):
            return {'timestamp': ts(second), 'type': kind, 'payload': payload}

        def message(second, text):
            return item(second, {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}]})

        def call(second, call_id):
            return item(second, {'type': 'function_call', 'name': 'exec_command', 'call_id': call_id, 'arguments': '{}'})

        def output(second, call_id, text):
            return item(second, {'type': 'function_call_output', 'call_id': call_id, 'output': [{'type': 'input_text', 'text': text}]})

        write_jsonl(path, [
            message(0, '# AGENTS.md instructions for D:\\repo\n- debugging \u2192 /ak-demo-skill'),
            message(1, '$ak-demo-skill audit'),
            item(2, {'type': 'reasoning'}), call(2, 'a'), call(2, 'b'), call(2, 'c'), call(2, 'd'),
            output(3, 'a', 'Chunk ID: 1\nProcess exited with code 1\nOutput:'),
            output(3, 'b', '{"chunk_id":"x","exit_code":2,"output":""}'),
            output(3, 'c', 'Process exited with code 0\n' + 'x' * 400 + 'Exit code: 1 appears in file content'),
            output(3, 'd', 'Exit code: 0'),
            item(4, {'type': 'turn_aborted', 'reason': 'interrupted'}, 'event_msg'),
            item(5, {'type': 'message', 'role': 'assistant', 'content': []}),
        ])
        [r] = session_usage.codex_invocations(path, self.sid)
        self.assertEqual((r['trigger'], r['subcommand']), ('user', 'audit'))
        self.assertEqual((r['turns'], r['tool_calls'], r['tool_errors'], r['interruptions']), (2, 4, 2, 1))

    def test_slug_match_requires_a_boundary(self):
        other = session_usage.SkillId('debug')
        self.assertEqual(other.files_in('cat ~/.codex/skills/ak-debug/SKILL.md'), set())
        self.assertEqual(other.files_in('cat ~/.codex/skills/debug/SKILL.md'), {'SKILL.md'})
        self.assertEqual(self.sid.files_in('x/not-ak-demo-skill/references/a.md'), set())

    def test_codex_model_trigger_requires_skill_read(self):
        path = self.root / 'codex' / 'r.jsonl'
        write_jsonl(path, [
            {'timestamp': ts(0), 'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'shell', 'call_id': 'a',
                                                                    'arguments': json.dumps({'cmd': 'ls ak-demo-skill/references'})}},
            {'timestamp': ts(1), 'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'shell', 'call_id': 'b',
                                                                    'arguments': json.dumps({'cmd': 'cat ak-demo-skill/SKILL.md'})}},
        ])
        records = list(session_usage.codex_invocations(path, self.sid))
        self.assertEqual([(r['trigger'], r['tool_calls']) for r in records], [('model', 1)])

    def test_archived_codex_copy_is_counted_once(self):
        events = [{'timestamp': ts(0), 'type': 'response_item', 'payload': {
            'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': '$ak-demo-skill audit'}]}}]
        write_jsonl(self.root / 'sessions' / '2026' / 'rollout-x.jsonl', events)
        write_jsonl(self.root / 'archived' / 'rollout-x.jsonl', events)
        out = io.StringIO()
        with redirect_stdout(out):
            session_usage.main(['ak-demo-skill', '--root', f'codex={self.root / "sessions"}',
                                '--root', f'codex={self.root / "archived"}', '--summary-only'])
        payload = json.loads(out.getvalue())
        self.assertEqual((payload['transcripts_scanned'], payload['summary']['invocations']), (1, 1))

    def test_signals_flag_delegation_errors_and_unread_references(self):
        skill = self.root / 'ak-demo-skill'
        (skill / 'references').mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: ak:demo-skill\n---\n', encoding='utf-8')
        for name in ('used.md', 'unused.md'):
            (skill / 'references' / name).write_text('x', encoding='utf-8')
        sid = session_usage.SkillId(str(skill))
        records = []
        for _ in range(5):
            record = session_usage.new_record('claude-code', 'abc', 'user', 'audit')
            record['tool_calls'], record['tools'] = 20, session_usage.Counter({'Read': 18, 'Bash': 2})
            record['errors_by_tool'], record['tool_errors'] = session_usage.Counter({'Bash': 1}), 1
            record['tokens']['output'] = 1000
            record['skill_files'] = session_usage.Counter({'references/used.md': 1})
            records.append(session_usage.finish(record, None, None))
        summary = session_usage.aggregate(records, sid)
        ids = {s['id'] for s in summary['signals']}
        self.assertEqual(summary['unused_skill_files'], ['references/unused.md'])
        self.assertTrue({'delegation-candidate', 'tool-error-rate', 'reference-never-loaded', 'reference-always-loaded'} <= ids, ids)

    def test_clean_rel_drops_escape_residue(self):
        self.assertEqual(session_usage.clean_rel('references/a.md/ngit'), 'references/a.md')
        self.assertEqual(session_usage.clean_rel('scripts\\tests\\n'), 'scripts/tests')
        self.assertEqual(session_usage.subcommand('cải thiện', {'audit'}), '(free-text)')
        self.assertEqual(session_usage.subcommand('Johnny please', {'audit'}), '(free-text)')
        self.assertEqual(session_usage.subcommand('Audit x', {'audit'}), 'audit')
        self.assertIsNone(session_usage.subcommand('  ', {'audit'}))
        self.assertEqual(self.sid.modes, {'audit', 'optimize'})

    def test_main_filters_sessions_and_reports_no_match(self):
        self.claude_fixture()
        root = f'claude-code={self.root / "claude"}'
        out = io.StringIO()
        with redirect_stdout(out):
            code = session_usage.main(['ak-demo-skill', '--root', root, '--summary-only'])
        payload = json.loads(out.getvalue())
        self.assertEqual((code, payload['summary']['invocations']), (0, 1))
        self.assertNotIn('invocations', payload)
        self.assertNotIn('thanks', out.getvalue())
        with redirect_stdout(io.StringIO()):
            self.assertEqual(session_usage.main(['ak-demo-skill', '--root', root, '--exclude-session', 'sess-claude-1']), 1)
            self.assertEqual(session_usage.main(['ak-demo-skill', '--root', root, '--entrypoint', 'codex_exec']), 1)


if __name__ == '__main__':
    unittest.main()
