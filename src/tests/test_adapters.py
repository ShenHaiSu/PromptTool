"""语法适配器单测。"""
from engine.adapters import adapt_to_model
from engine.models import PromptIR, IRSegment, AssemblyConfig


def make_ir(text, weight=1.0, dim_key="top"):
    return PromptIR(segments=[
        IRSegment(dimension_key=dim_key, text=text, weight=weight, source_module_id="m1")
    ])


class TestSDAdapter:
    def test_weight_one_no_bracket(self):
        ir = make_ir("white shirt", 1.0)
        config = AssemblyConfig(model_profile="sd")
        assert adapt_to_model(ir, "sd", config) == "white shirt"

    def test_weight_above_one_parenthesis(self):
        ir = make_ir("white shirt", 1.2)
        config = AssemblyConfig(model_profile="sd")
        assert adapt_to_model(ir, "sd", config) == "(white shirt:1.2)"

    def test_weight_below_one_brackets(self):
        ir = make_ir("white shirt", 0.8)
        config = AssemblyConfig(model_profile="sd")
        assert adapt_to_model(ir, "sd", config) == "[white shirt]"

    def test_brackets_disabled(self):
        ir = make_ir("white shirt", 1.5)
        config = AssemblyConfig(model_profile="sd", use_weight_brackets=False)
        assert adapt_to_model(ir, "sd", config) == "white shirt"

    def test_multiple_segments_joined(self):
        ir = PromptIR(segments=[
            IRSegment("top", "white shirt", 1.0, "m1"),
            IRSegment("bottom", "pleated skirt", 1.5, "m2"),
        ])
        config = AssemblyConfig(separator=", ", model_profile="sd")
        result = adapt_to_model(ir, "sd", config)
        assert result == "white shirt, (pleated skirt:1.5)"
