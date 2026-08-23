"""拼装引擎单测。"""
from engine.assembly import assemble, sort_by_order
from engine.models import SelectedItem, AssemblyConfig


class TestAssemble:
    def test_basic_assembly(self, sample_modules, default_config):
        selected = [
            SelectedItem(module=sample_modules["top"]),
            SelectedItem(module=sample_modules["bottom"]),
        ]
        ir, final = assemble(selected, default_config)
        assert len(ir.segments) == 2
        assert "oversized white shirt" in final
        assert "high-waisted pleated skirt" in final

    def test_weight_override_applied(self, sample_modules):
        config = AssemblyConfig(use_weight_brackets=True, model_profile="sd")
        selected = [
            SelectedItem(module=sample_modules["top"], weight_override=1.5),
        ]
        ir, final = assemble(selected, config)
        assert "(oversized white shirt:1.5)" in final

    def test_weight_below_one_uses_brackets(self, sample_modules):
        config = AssemblyConfig(use_weight_brackets=True, model_profile="sd")
        selected = [
            SelectedItem(module=sample_modules["top"], weight_override=0.7),
        ]
        ir, final = assemble(selected, config)
        assert "[oversized white shirt]" in final

    def test_weight_one_no_brackets(self, sample_modules, default_config):
        selected = [
            SelectedItem(module=sample_modules["top"]),
        ]
        ir, final = assemble(selected, default_config)
        assert final == "oversized white shirt"

    def test_separator_comma(self, sample_modules):
        config = AssemblyConfig(separator=", ", model_profile="sd")
        selected = [
            SelectedItem(module=sample_modules["top"]),
            SelectedItem(module=sample_modules["bottom"]),
        ]
        ir, final = assemble(selected, config)
        assert ", " in final

    def test_separator_break(self, sample_modules):
        config = AssemblyConfig(separator=" BREAK ", model_profile="sd")
        selected = [
            SelectedItem(module=sample_modules["top"]),
            SelectedItem(module=sample_modules["bottom"]),
        ]
        ir, final = assemble(selected, config)
        assert " BREAK " in final


class TestSortByOrder:
    def test_dimension_order(self, sample_modules):
        items = [
            SelectedItem(module=sample_modules["bottom"]),   # bottom, order=4
            SelectedItem(module=sample_modules["top"]),       # top, order=3
        ]
        ordered = sort_by_order(items, "dimensionOrder")
        assert ordered[0].module.dimension_key == "top"
        assert ordered[1].module.dimension_key == "bottom"

    def test_custom_order_preserved(self, sample_modules):
        items = [
            SelectedItem(module=sample_modules["bottom"]),
            SelectedItem(module=sample_modules["top"]),
        ]
        ordered = sort_by_order(items, "customDragOrder")
        assert ordered[0].module.dimension_key == "bottom"
        assert ordered[1].module.dimension_key == "top"
