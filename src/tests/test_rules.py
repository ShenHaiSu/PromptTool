"""规则引擎单测：验证 3 条预置规则的判定逻辑。"""
from engine.rules import apply_rules
from engine.models import SelectedItem


class TestRule01OutfitMutex:
    """R01: 套装互斥 — 选了 outfit 后 top/bottom 应被剔除。"""

    def test_outfit_removes_top_and_bottom(self, sample_modules):
        selected = [
            SelectedItem(module=sample_modules["outfit"]),
            SelectedItem(module=sample_modules["top"]),
            SelectedItem(module=sample_modules["bottom"]),
        ]
        filtered, warnings = apply_rules(selected)
        dim_keys = {it.module.dimension_key for it in filtered}
        assert "outfit" in dim_keys
        assert "top" not in dim_keys
        assert "bottom" not in dim_keys
        assert any("全身套装" in w for w in warnings)

    def test_outfit_keeps_locked_top(self, sample_modules):
        """锁定项应被保留。"""
        selected = [
            SelectedItem(module=sample_modules["outfit"]),
            SelectedItem(module=sample_modules["top"], locked=True),
        ]
        filtered, warnings = apply_rules(selected)
        dim_keys = {it.module.dimension_key for it in filtered}
        assert "top" in dim_keys  # 锁定的 top 被保留


class TestRule02ShoesBarefootMutex:
    """R02: 鞋袜与赤脚互斥。"""

    def test_barefoot_and_shoes_cannot_coexist(self, sample_modules):
        selected = [
            SelectedItem(module=sample_modules["shoes_bare"]),
            SelectedItem(module=sample_modules["shoes_sneaker"]),
        ]
        filtered, warnings = apply_rules(selected)
        contents = {it.module.content_en for it in filtered}
        assert "barefoot" in contents or "white sneakers" in contents
        assert not ("barefoot" in contents and "white sneakers" in contents)
        assert any("赤脚" in w for w in warnings)


class TestRule03BackgroundMutex:
    """R03: 室内外背景互斥。"""

    def test_studio_and_outdoor_cannot_coexist(self, sample_modules):
        selected = [
            SelectedItem(module=sample_modules["bg_studio"]),
            SelectedItem(module=sample_modules["bg_beach"]),
        ]
        filtered, warnings = apply_rules(selected)
        contents = {it.module.content_en for it in filtered}
        assert "minimalist studio, white backdrop" in contents
        assert "cherry blossom street, soft sunlight" not in contents
        assert any("室内背景" in w for w in warnings)
