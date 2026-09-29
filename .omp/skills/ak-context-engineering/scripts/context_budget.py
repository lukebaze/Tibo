"""Separate context headroom from cumulative task-token accounting."""
import math


def nonnegative(name, value):
    try:
        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) and value >= 0
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError(f"{name} must be finite and nonnegative")
    return value


def capacity(used, window, next_step=0, output_reserve=0, checkpoint_reserve=0):
    for name, value in (("used", used), ("next_step", next_step),
                        ("output_reserve", output_reserve), ("checkpoint_reserve", checkpoint_reserve)):
        nonnegative(name, value)
    if window is not None and nonnegative("window", window) == 0:
        raise ValueError("window must be positive when supplied")
    required = nonnegative("required headroom", next_step + output_reserve + checkpoint_reserve)
    remaining = None if window is None else window - used
    utilization = None if window is None else nonnegative("utilization", used / window)
    band = "unknown" if utilization is None else (
        "red" if utilization >= .85 else "orange" if utilization >= .70
        else "yellow" if utilization >= .50 else "green")
    fits = None if remaining is None else remaining >= required
    return {"window": window, "used": used, "remaining": remaining,
            "utilization": utilization, "band": band, "band_basis": "advisory-defaults",
            "next_step": next_step, "output_reserve": output_reserve,
            "checkpoint_reserve": checkpoint_reserve, "required_headroom": required,
            "next_step_fits": fits,
            "checkpoint_recommended": None if fits is None else not fits or band in ("orange", "red")}


def calculate_budget(system, tools, docs, history, buffer_pct=.15, *, window=None,
                     next_step=0, output_reserve=None, checkpoint_reserve=0,
                     task_limit=None, task_spent=0, agent_budgets=None,
                     verification_reserve=0):
    components = dict(system_prompt=system, tool_definitions=tools,
                      retrieved_docs=docs, message_history=history)
    for name, value in components.items():
        nonnegative(name, value)
    if not 0 <= nonnegative("buffer", buffer_pct) <= 1:
        raise ValueError("buffer must be between 0 and 1")
    subtotal = nonnegative("context subtotal", sum(components.values()))
    reserve = int(subtotal * buffer_pct) if output_reserve is None else output_reserve
    context = capacity(subtotal, window, next_step, reserve, checkpoint_reserve)
    nonnegative("task_spent", task_spent)
    nonnegative("verification_reserve", verification_reserve)
    if task_limit is not None:
        nonnegative("task_limit", task_limit)
    agents = agent_budgets or {}
    for name, value in agents.items():
        if not isinstance(name, str) or not name.strip():
            raise ValueError("agent names must not be empty")
        nonnegative(f"agent {name}", value)
    allocated = nonnegative("unspent allocations", sum(agents.values()))
    committed = nonnegative("task commitments", task_spent + allocated + verification_reserve)
    available = None if task_limit is None else task_limit - committed
    total = nonnegative("total budget", subtotal + reserve)
    return {
        "schema_version": 2, "measurement": "caller-supplied-token-accounting",
        "allocation": {**components, "reserved_buffer": reserve},
        "total_budget": total,
        "warning_threshold": None if window is None else int(window * .70),
        "critical_threshold": None if window is None else int(window * .85),
        "context": context,
        "task": {"limit": task_limit, "spent_all_agents": task_spent,
                 "unspent_agent_allocations": agents, "verification_reserve": verification_reserve,
                 "available_unallocated": available,
                 "overcommitted": None if available is None else available < 0},
        "recommendations": [
            "Context categories must be disjoint; tool results already in history are not counted twice.",
            "Task spend includes all calls, agents and retries; agent allocations are unspent only.",
            "Token counts are not dollars or provider quota; cached billing uses a separate cost ledger.",
            "Unknown limits stay unknown. Reserves are estimates, not enforced runtime settings."]}


def add_budget_arguments(parser):
    for name, default in (("system", 2000), ("tools", 1500), ("docs", 3000), ("history", 5000)):
        parser.add_argument(f"--{name}", type=int, default=default)
    parser.add_argument("--buffer", type=float, default=.15, help="Legacy subtotal fraction, not window percentage")
    parser.add_argument("--window", type=int)
    parser.add_argument("--next-step", type=int, default=0)
    parser.add_argument("--output-reserve", type=int)
    parser.add_argument("--checkpoint-reserve", type=int, default=0)
    parser.add_argument("--task-limit", type=int)
    parser.add_argument("--task-spent", type=int, default=0)
    parser.add_argument("--verification-reserve", type=int, default=0)
    parser.add_argument("--agent-budget", action="append", default=[], metavar="NAME=TOKENS")


def budget_from_args(args):
    agents = {}
    for item in args.agent_budget:
        name, separator, value = item.partition("=")
        if not separator or not name.strip() or name in agents:
            raise ValueError("agent-budget must use distinct NAME=TOKENS entries")
        agents[name] = int(value)
    return calculate_budget(args.system, args.tools, args.docs, args.history, args.buffer,
        window=args.window, next_step=args.next_step, output_reserve=args.output_reserve,
        checkpoint_reserve=args.checkpoint_reserve, task_limit=args.task_limit,
        task_spent=args.task_spent, verification_reserve=args.verification_reserve,
        agent_budgets=agents)
