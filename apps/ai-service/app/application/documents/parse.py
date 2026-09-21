"""
Parsers normalize each supported mime type down to plain text. Chunking
(chunk.py) and everything downstream never knows what format a document
originally was.
"""

import io

from bs4 import BeautifulSoup
from markdown_it import MarkdownIt
from pypdf import PdfReader

from app.domain.errors import UnsupportedDocumentType

_md = MarkdownIt()

SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/html",
}


def _html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator="\n")


def parse_document(content: bytes, mime_type: str) -> str:
    if mime_type == "application/pdf":
        reader = PdfReader(io.BytesIO(content))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if mime_type == "text/plain":
        return content.decode("utf-8", errors="replace")
    if mime_type == "text/markdown":
        html = _md.render(content.decode("utf-8", errors="replace"))
        return _html_to_text(html)
    if mime_type == "text/html":
        return _html_to_text(content.decode("utf-8", errors="replace"))
    raise UnsupportedDocumentType(f"Unsupported mime type: {mime_type}")


def normalize_text(text: str) -> str:
    """Collapse repeated blank lines/whitespace left over from parsing — keeps chunk boundaries meaningful."""
    lines = [line.strip() for line in text.splitlines()]
    normalized: list[str] = []
    for line in lines:
        if line or (normalized and normalized[-1]):
            normalized.append(line)
    return "\n".join(normalized).strip()
