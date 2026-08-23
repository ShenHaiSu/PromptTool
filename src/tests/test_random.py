"""随机引擎单测。"""
import random
from engine.random_engine import random_assembly
from engine.models import Dimension, Module, AssemblyConfig


class TestRandomAssembly:
    def setup_method(self):
        random.seed(42)  # 固定随机种子，保证可复现

    def test_returns_requested_count(self, sample_dimensions, sample_modules, default_config):
        dims = sample_dimensions
        modules_by_dim = {
            "top": [sample_modules["top"]],
            "bottom": [sample_modules["bottom"]],
            "outfit": [sample_modules["outfit"]],
            "shoes": [sample_modules["shoes_sneaker"], sample_modules["shoes_bare"]],
            "background": [sample_modules["bg_studio"], sample_modules["bg_beach"]],
        }
        results = random_assembly(dims, modules_by_dim, set(), 10, default_config)
        assert len(results) <= 10
        assert len(results) > 0

    def test_no_duplicates(self, sample_dimensions, sample_modules, default_config):
        modules_by_dim = {
            "top": [sample_modules["top"]],
            "bottom": [sample_modules["bottom"]],
        }
        results = random_assembly(
            sample_dimensions[:2], modules_by_dim, set(), 10, default_config
        )
        hashes = [ir.hash() for ir in results]
        assert len(hashes) == len(set(hashes))  # 无重复

    def test_locked_items_preserved(self, sample_dimensions, sample_modules, default_config):
        modules_by_dim = {
            "top": [sample_modules["top"]],
            "bottom": [sample_modules["bottom"]],
        }
        locked = {sample_modules["top"].id}
        results = random_assembly(
            sample_dimensions[:2], modules_by_dim, locked, 5, default_config
        )
        for ir in results:
            top_segments = [s for s in ir.segments if s.dimension_key == "top"]
            assert any("oversized white shirt" in s.text for s in top_segments)

    def test_empty_pool_skipped(self, sample_dimensions, default_config):
        results = random_assembly(
            sample_dimensions, {}, set(), 5, default_config
        )
        assert len(results) == 0

    def test_nsfw_excluded_by_default(self, sample_dimensions, sample_modules, default_config):
        """allow_nsfw=False（默认）时，NSFW 条目不出现在结果中。"""
        modules_by_dim = {
            "top": [sample_modules["top"], sample_modules["top_nsfw"]],
            "bottom": [sample_modules["bottom"]],
        }
        results = random_assembly(
            sample_dimensions[:2], modules_by_dim, set(), 20, default_config
        )
        for ir in results:
            for seg in ir.segments:
                assert seg.text != "no bra, bare cleavage visible"

    def test_nsfw_included_when_allowed(self, sample_dimensions, sample_modules, default_config):
        """allow_nsfw=True 时，NSFW 条目可出现在结果中。"""
        modules_by_dim = {
            "top": [sample_modules["top_nsfw"]],
            "bottom": [sample_modules["bottom"]],
        }
        results = random_assembly(
            sample_dimensions[:2], modules_by_dim, set(), 5, default_config,
            allow_nsfw=True,
        )
        assert len(results) > 0
        for ir in results:
            assert any("bare cleavage" in s.text for s in ir.segments)

    def test_nsfw_locked_still_excluded_when_filter_on(
        self, sample_dimensions, sample_modules, default_config
    ):
        """allow_nsfw=False 时，即使锁定 NSFW 条目也不会出现在结果中。"""
        nsfw_mod = sample_modules["top_nsfw"]
        modules_by_dim = {
            "top": [sample_modules["top"], nsfw_mod],
            "bottom": [sample_modules["bottom"]],
        }
        locked = {nsfw_mod.id}
        results = random_assembly(
            sample_dimensions[:2], modules_by_dim, locked, 10, default_config,
            allow_nsfw=False,
        )
        for ir in results:
            for seg in ir.segments:
                assert seg.text != "no bra, bare cleavage visible"
