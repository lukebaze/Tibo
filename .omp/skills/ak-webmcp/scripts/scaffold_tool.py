#!/usr/bin/env python3
"""Scaffold a WebMCP tool (imperative JS or declarative HTML) from the CLI.

Dependency-free (Python 3.8+ stdlib only). Emits ready-to-paste boilerplate to
stdout for the current WebMCP API (`document.modelContext`).

Usage:
    scaffold_tool.py --name NAME --description DESC [options]

Options:
    --mode {imperative,declarative}   Output style (default: imperative).
    --title TITLE                     Human-readable tool title (imperative).
    --param SPEC                      Repeatable. SPEC = name:type[:description]
                                      type in string|number|integer|boolean.
    --enum NAME=a,b,c                 Repeatable. Make a param an enum.
    --required NAME[,NAME...]         Comma list of required params.
    --read-only                       Set annotations.readOnlyHint = true.
    --consequential                   Set annotations.consequentialHint = true.
    --untrusted                       Set annotations.untrustedContentHint = true.
    --action PATH                     Form action (declarative, default '/submit').
    --autosubmit                      Add toolautosubmit (declarative).

Examples:
    scaffold_tool.py --name search_products \\
        --description "Search the product catalog by keyword." \\
        --param query:string:"Search keyword" \\
        --param category:string --enum category=books,music,film \\
        --required query --read-only

    scaffold_tool.py --mode declarative --name create_support_request \\
        --description "Submit a request for customer support." \\
        --param firstName:string --param lastName:string --autosubmit
"""

import argparse
import html
import json
import sys

VALID_TYPES = {"string", "number", "integer", "boolean"}
NAME_BUDGET = 30
DESC_BUDGET = 500
PARAM_DESC_BUDGET = 150


def parse_param(spec):
    # name:type[:description]
    parts = spec.split(":", 2)
    name = parts[0].strip()
    ptype = parts[1].strip() if len(parts) > 1 and parts[1].strip() else "string"
    desc = parts[2].strip().strip('"').strip("'") if len(parts) > 2 else ""
    if not name:
        sys.exit(f"error: --param needs a name in '{spec}'")
    if ptype not in VALID_TYPES:
        sys.exit(f"error: --param type '{ptype}' must be one of {sorted(VALID_TYPES)}")
    return {"name": name, "type": ptype, "description": desc}


def warn_budgets(name, description, params):
    if len(name) > NAME_BUDGET:
        print(f"warning: tool name '{name}' is {len(name)} chars (budget {NAME_BUDGET})", file=sys.stderr)
    if len(description) > DESC_BUDGET:
        print(f"warning: description is {len(description)} chars (budget {DESC_BUDGET})", file=sys.stderr)
    for p in params:
        if len(p["name"]) > NAME_BUDGET:
            print(f"warning: param name '{p['name']}' is {len(p['name'])} chars (budget {NAME_BUDGET})", file=sys.stderr)
        if len(p["description"]) > PARAM_DESC_BUDGET:
            print(f"warning: param '{p['name']}' description is {len(p['description'])} chars (budget {PARAM_DESC_BUDGET})", file=sys.stderr)


def build_schema(params, enums, required):
    properties = {}
    for p in params:
        prop = {"type": p["type"]}
        if p["name"] in enums:
            prop["enum"] = enums[p["name"]]
        if p["description"]:
            prop["description"] = p["description"]
        properties[p["name"]] = prop
    schema = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def indent(text, spaces):
    pad = " " * spaces
    return "\n".join(pad + line if line else line for line in text.split("\n"))


def emit_imperative(args, params, enums, required, annotations):
    schema = build_schema(params, enums, required)
    schema_js = indent(json.dumps(schema, indent=2), 2).lstrip()
    arg_names = ", ".join(p["name"] for p in params) or ""
    destructure = f"{{ {arg_names} }}" if arg_names else "_args"
    lines = []
    lines.append("await document.modelContext.registerTool({")
    lines.append(f"  name: {json.dumps(args.name)},")
    if args.title:
        lines.append(f"  title: {json.dumps(args.title)},")
    lines.append(f"  description: {json.dumps(args.description)},")
    lines.append(f"  inputSchema: {schema_js},")
    if annotations:
        ann = ", ".join(f"{k}: true" for k in annotations)
        lines.append(f"  annotations: {{ {ann} }},")
    lines.append(f"  execute: async ({destructure}, {{ signal }}) => {{")
    lines.append("    // TODO: implement using your existing app logic.")
    lines.append("    // Validate strictly here; return a concise string result (<=1.5K chars).")
    lines.append(f"    return `TODO: {args.name} executed`;")
    lines.append("  },")
    lines.append("});")
    return "\n".join(lines)


def emit_react(args, params, enums, required, annotations):
    schema = build_schema(params, enums, required)
    schema_js = indent(json.dumps(schema, indent=2), 4).lstrip()
    arg_names = ", ".join(p["name"] for p in params) or ""
    destructure = f"{{ {arg_names} }}" if arg_names else "_args"
    comp = "".join(w.capitalize() for w in args.name.replace(".", "_").replace("-", "_").split("_"))
    lines = []
    lines.append("import { useWebMCP } from 'usewebmcp';")
    lines.append("// Requires document.modelContext (native, or via @mcp-b/webmcp-polyfill).")
    lines.append("")
    lines.append(f"export function {comp}Tool() {{")
    lines.append("  useWebMCP({")
    lines.append(f"    name: {json.dumps(args.name)},")
    lines.append(f"    description: {json.dumps(args.description)},")
    lines.append(f"    inputSchema: {schema_js} as const,")
    if annotations:
        ann = ", ".join(f"{k}: true" for k in annotations)
        lines.append(f"    annotations: {{ {ann} }},")
    lines.append(f"    execute: async ({destructure}) => {{")
    lines.append("      // TODO: call your existing app logic; return a concise value.")
    lines.append(f"      return `TODO: {args.name} executed`;")
    lines.append("    },")
    lines.append("  });")
    lines.append("  return null; // hook registers on mount, unregisters on unmount")
    lines.append("}")
    return "\n".join(lines)


def emit_declarative(args, params, enums, required):
    esc = lambda v: html.escape(str(v), quote=True)
    attrs = [f'toolname="{esc(args.name)}"', f'tooldescription="{esc(args.description)}"']
    if args.autosubmit:
        attrs.append("toolautosubmit")
    attrs.append(f'action="{esc(args.action)}"')
    lines = ["<form " + "\n      ".join(attrs) + ">"]
    for p in params:
        name = p["name"]
        req = " required" if name in required else ""
        pd = f' toolparamdescription="{esc(p["description"])}"' if p["description"] else ""
        lines.append(f'  <label for="{esc(name)}">{esc(name)}</label>')
        if name in enums:
            lines.append(f'  <select name="{esc(name)}" id="{esc(name)}"{req}{pd}>')
            for opt in enums[name]:
                lines.append(f'    <option value="{esc(opt)}">{esc(opt)}</option>')
            lines.append("  </select>")
        else:
            itype = "number" if p["type"] in ("number", "integer") else "text"
            lines.append(f'  <input type="{itype}" '
                         f'name="{esc(name)}" id="{esc(name)}"{req}{pd}>')
    lines.append("  <button type=\"submit\">Submit</button>")
    lines.append("</form>")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(add_help=True, description="Scaffold a WebMCP tool.")
    ap.add_argument("--name", required=True)
    ap.add_argument("--description", required=True)
    ap.add_argument("--mode", choices=["imperative", "declarative"], default="imperative")
    ap.add_argument("--title", default="")
    ap.add_argument("--param", action="append", default=[])
    ap.add_argument("--enum", action="append", default=[])
    ap.add_argument("--required", default="")
    ap.add_argument("--read-only", dest="read_only", action="store_true")
    ap.add_argument("--consequential", action="store_true")
    ap.add_argument("--untrusted", action="store_true")
    ap.add_argument("--action", default="/submit")
    ap.add_argument("--autosubmit", action="store_true")
    ap.add_argument("--framework", choices=["vanilla", "react"], default="vanilla",
                    help="imperative output flavor (react emits a usewebmcp hook)")
    args = ap.parse_args()

    params = [parse_param(s) for s in args.param]
    enums = {}
    for e in args.enum:
        if "=" not in e:
            sys.exit(f"error: --enum needs NAME=a,b,c in '{e}'")
        k, v = e.split("=", 1)
        enums[k.strip()] = [x.strip() for x in v.split(",") if x.strip()]
    required = [x.strip() for x in args.required.split(",") if x.strip()]

    known = {p["name"] for p in params}
    for r in required:
        if r not in known:
            print(f"warning: required '{r}' is not a declared --param", file=sys.stderr)
    for k in enums:
        if k not in known:
            print(f"warning: --enum '{k}' is not a declared --param", file=sys.stderr)

    warn_budgets(args.name, args.description, params)

    annotations = []
    if args.read_only:
        annotations.append("readOnlyHint")
    if args.consequential:
        annotations.append("consequentialHint")
    if args.untrusted:
        annotations.append("untrustedContentHint")

    if args.mode == "imperative":
        if args.framework == "react":
            if args.title:
                print("note: --title is not a usewebmcp config field; ignored in react mode", file=sys.stderr)
            print(emit_react(args, params, enums, required, annotations))
        else:
            print(emit_imperative(args, params, enums, required, annotations))
    else:
        if annotations:
            print("note: annotations are imperative-only; ignored in declarative mode", file=sys.stderr)
        if args.framework != "vanilla":
            print("note: --framework applies to imperative mode; ignored", file=sys.stderr)
        print(emit_declarative(args, params, enums, required))


if __name__ == "__main__":
    main()
