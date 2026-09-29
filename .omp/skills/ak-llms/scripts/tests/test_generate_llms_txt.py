import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "generate-llms-txt.py"
spec = importlib.util.spec_from_file_location("generate_llms_txt", SCRIPT)
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

BASE = "https://example.com/docs/"


class BuildUrlTest(unittest.TestCase):
    def test_without_base_url_keeps_source_path(self):
        self.assertEqual(gen.build_url("guide/intro.md", ""), "guide/intro.md")

    def test_html_urls_drop_extension_and_index(self):
        self.assertEqual(gen.build_url("guide/intro.mdx", BASE), "https://example.com/docs/guide/intro")
        self.assertEqual(gen.build_url("guide/index.md", BASE), "https://example.com/docs/guide")
        self.assertEqual(gen.build_url("index.md", BASE), "https://example.com/docs/")

    def test_markdown_variant_urls(self):
        self.assertEqual(gen.build_url("guide/intro.mdx", BASE, True), "https://example.com/docs/guide/intro.md")
        self.assertEqual(gen.build_url("guide/index.md", BASE, True), "https://example.com/docs/guide.md")
        self.assertEqual(gen.build_url("index.md", BASE, True), "https://example.com/docs/index.html.md")
        self.assertEqual(gen.build_url("guide\\intro.md", BASE, True), "https://example.com/docs/guide/intro.md")

    def test_trailing_slash_sites(self):
        self.assertEqual(gen.build_url("guide/index.md", BASE, trailing_slash=True), "https://example.com/docs/guide/")
        self.assertEqual(
            gen.build_url("guide/index.md", BASE, True, trailing_slash=True),
            "https://example.com/docs/guide/index.html.md",
        )


class GenerateTest(unittest.TestCase):
    docs = [
        {
            "rel_path": "guide/intro.md",
            "title": "Intro",
            "description": "Start here",
            "category": "Getting Started",
            "content": "---\ntitle: Intro\n---\n# Intro\n\nBody text.\n",
        }
    ]

    def test_llms_txt_links_markdown_variants(self):
        out = gen.generate_llms_txt(self.docs, "Proj", "Summary", BASE, md_links=True)
        self.assertIn("# Proj\n\n> Summary\n", out)
        self.assertIn("- [Intro](https://example.com/docs/guide/intro.md): Start here", out)

    def test_llms_full_txt_records_canonical_source(self):
        out = gen.generate_llms_full_txt(self.docs, "Proj", "", BASE)
        self.assertIn("### Intro\n\nSource: https://example.com/docs/guide/intro\n\nBody text.", out)
        self.assertNotIn("title: Intro", out)


if __name__ == "__main__":
    unittest.main()
