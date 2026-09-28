"""Herramientas de investigación: cuaderno de hipótesis y calculadora científica."""

from __future__ import annotations

import ast
import math
import operator
import statistics
from typing import Any, Callable

from ..notebook import EVIDENCE_KINDS, STATES, Notebook
from .base import Tool, ToolContext, ToolError, schema


def build_notebook_tools(notebook: Notebook, on_change: Callable[[], Any] | None = None) -> list[Tool]:
    def changed() -> None:
        if on_change:
            on_change()

    def guard(fn):
        async def wrapper(args: dict[str, Any], ctx: ToolContext):
            try:
                return fn(args, ctx)
            except (KeyError, ValueError) as exc:
                raise ToolError(str(exc).strip("'\"")) from exc
        return wrapper

    @guard
    def registrar(args, ctx):
        h = notebook.add(
            str(args.get("titulo", "")), str(args.get("enunciado", "")),
            str(args.get("autor") or ctx.speaker), int(args.get("confianza", 50)),
            [str(t) for t in args.get("etiquetas") or []],
        )
        changed()
        return f"Registrada {h.id}: {h.title}"

    @guard
    def evidencia(args, ctx):
        h = notebook.add_evidence(
            str(args["id"]), str(args.get("tipo", "neutral")), str(args.get("descripcion", "")),
            str(args.get("fuente", "")), str(args.get("autor") or ctx.speaker),
        )
        changed()
        return f"Evidencia añadida a {h.id}. " + h.brief()

    @guard
    def prueba(args, ctx):
        h = notebook.add_test(
            str(args["id"]), str(args.get("descripcion", "")), str(args.get("prediccion", "")),
            str(args.get("autor") or ctx.speaker),
        )
        changed()
        return f"Prueba P{len(h.tests)} propuesta para {h.id}."

    @guard
    def resultado(args, ctx):
        h = notebook.record_result(str(args["id"]), int(args["prueba"]), str(args.get("resultado", "")))
        changed()
        return f"Resultado anotado en {h.id} P{args['prueba']}."

    @guard
    def estado(args, ctx):
        conf = args.get("confianza")
        h = notebook.update_state(
            str(args["id"]), args.get("estado") or None,
            None if conf is None else int(conf), str(args.get("nota", "")),
        )
        changed()
        return "Actualizada. " + h.brief()

    @guard
    def listar(args, ctx):
        wanted = args.get("estado")
        items = [h for h in notebook.all() if not wanted or h.state == wanted]
        if not items:
            return "El cuaderno está vacío." if not wanted else f"No hay hipótesis en estado {wanted}."
        return "\n".join(h.brief() for h in items)

    @guard
    def ver(args, ctx):
        return notebook.get(str(args["id"])).detail()

    hid = {"type": "string", "description": "Id de la hipótesis, p. ej. 'H3'."}
    return [
        Tool("cuaderno_registrar",
             "Registra una hipótesis nueva en el cuaderno de investigación compartido. Formúlala de "
             "modo que sea falsable.",
             schema({
                 "titulo": {"type": "string", "description": "Título breve."},
                 "enunciado": {"type": "string", "description": "Hipótesis precisa y falsable."},
                 "autor": {"type": "string", "description": "Quién la propone (por defecto, quien habla)."},
                 "confianza": {"type": "integer", "description": "Credibilidad inicial 0-100."},
                 "etiquetas": {"type": "array", "items": {"type": "string"}},
             }, ["titulo", "enunciado"]),
             registrar, guest_ok=True),
        Tool("cuaderno_evidencia", "Añade una evidencia a favor, en contra o neutral a una hipótesis.",
             schema({
                 "id": hid,
                 "tipo": {"type": "string", "enum": list(EVIDENCE_KINDS)},
                 "descripcion": {"type": "string"},
                 "fuente": {"type": "string", "description": "Estudio, dato, observación o experimento."},
                 "autor": {"type": "string"},
             }, ["id", "tipo", "descripcion"]),
             evidencia, guest_ok=True),
        Tool("cuaderno_prueba", "Propone una prueba o experimento con una predicción concreta que "
             "pueda salir mal si la hipótesis es falsa.",
             schema({
                 "id": hid,
                 "descripcion": {"type": "string"},
                 "prediccion": {"type": "string"},
                 "autor": {"type": "string"},
             }, ["id", "descripcion", "prediccion"]),
             prueba, guest_ok=True),
        Tool("cuaderno_resultado", "Anota el resultado observado de una prueba (P1, P2…) de una hipótesis.",
             schema({"id": hid, "prueba": {"type": "integer", "description": "Número de la prueba."},
                     "resultado": {"type": "string"}}, ["id", "prueba", "resultado"]),
             resultado, guest_ok=True),
        Tool("cuaderno_estado", "Cambia el estado o la confianza de una hipótesis y deja una nota del porqué.",
             schema({
                 "id": hid,
                 "estado": {"type": "string", "enum": list(STATES)},
                 "confianza": {"type": "integer"},
                 "nota": {"type": "string"},
             }, ["id"]),
             estado, guest_ok=True),
        Tool("cuaderno_listar", "Lista las hipótesis del cuaderno, opcionalmente filtradas por estado.",
             schema({"estado": {"type": "string", "enum": list(STATES)}}),
             listar, guest_ok=True),
        Tool("cuaderno_ver", "Muestra una hipótesis con todas sus evidencias, pruebas y notas.",
             schema({"id": hid}, ["id"]), ver, guest_ok=True),
    ]


# --- Calculadora segura -----------------------------------------------------

_BIN_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_CMP_OPS = {ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt,
            ast.GtE: operator.ge, ast.Eq: operator.eq, ast.NotEq: operator.ne}

_NAMES: dict[str, Any] = {name: getattr(math, name) for name in dir(math) if not name.startswith("_")}


def _limited_factorial(n: int) -> int:
    if n > 5000:
        raise ToolError("factorial demasiado grande (máximo 5000).")
    return math.factorial(n)


_NAMES["factorial"] = _limited_factorial
_NAMES.update({
    "abs": abs, "min": min, "max": max, "sum": sum, "round": round, "len": len,
    "media": statistics.mean, "mean": statistics.mean, "mediana": statistics.median,
    "median": statistics.median, "moda": statistics.mode, "desv": statistics.stdev,
    "stdev": statistics.stdev, "pstdev": statistics.pstdev, "varianza": statistics.variance,
    "variance": statistics.variance, "correlacion": statistics.correlation,
    "correlation": statistics.correlation,
})


def safe_eval(expression: str) -> Any:
    tree = ast.parse(expression.replace("^", "**"), mode="eval")

    def ev(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and (
                abs(right) > 1000
                or (isinstance(left, int) and left.bit_length() * abs(right) > 100_000)
            ):
                raise ToolError("Número demasiado grande.")
            return _BIN_OPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
            return _UNARY_OPS[type(node.op)](ev(node.operand))
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and type(node.ops[0]) in _CMP_OPS:
            return _CMP_OPS[type(node.ops[0])](ev(node.left), ev(node.comparators[0]))
        if isinstance(node, (ast.List, ast.Tuple)):
            return [ev(e) for e in node.elts]
        if isinstance(node, ast.Name) and node.id in _NAMES:
            return _NAMES[node.id]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _NAMES:
            if node.keywords:
                raise ToolError("No se admiten argumentos con nombre.")
            return _NAMES[node.func.id](*[ev(a) for a in node.args])
        raise ToolError(f"Expresión no permitida: {ast.unparse(node)}")

    return ev(tree)


def build_calc_tool() -> Tool:
    async def calcular(args: dict[str, Any], ctx: ToolContext) -> str:
        expr = str(args.get("expresion", ""))
        try:
            value = safe_eval(expr)
        except ToolError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ToolError(f"No pude calcular '{expr}': {exc}") from exc
        return f"{expr} = {value}"

    return Tool(
        "calcular",
        "Calculadora exacta para cuentas y estadística. Admite + - * / ** %, funciones de math "
        "(sqrt, log, sin, exp, factorial, comb…) y media([..]), mediana, desv, varianza, "
        "correlacion([x],[y]). Úsala en vez de calcular de cabeza.",
        schema({"expresion": {"type": "string", "description": "p. ej. 'media([3, 5, 8])'"}}, ["expresion"]),
        calcular, guest_ok=True,
    )
