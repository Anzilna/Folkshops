from uuid import uuid4

from app.application.documents.chunk import RecursiveTextChunker


def test_short_text_is_a_single_chunk():
    chunker = RecursiveTextChunker(chunk_size=1000, chunk_overlap=0)
    chunks = chunker.chunk("A short paragraph.", uuid4(), uuid4())
    assert len(chunks) == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].content == "A short paragraph."


def test_long_text_splits_into_multiple_chunks_within_size_limit():
    chunker = RecursiveTextChunker(chunk_size=50, chunk_overlap=0)
    text = "\n\n".join(f"Paragraph number {i} with some extra padding text." for i in range(10))
    chunks = chunker.chunk(text, uuid4(), uuid4())
    assert len(chunks) > 1
    assert all(len(c.content) <= 50 + 20 for c in chunks)  # small slack for split-point rounding


def test_chunk_indexes_are_sequential():
    chunker = RecursiveTextChunker(chunk_size=30, chunk_overlap=0)
    text = "One two three four five six seven eight nine ten eleven twelve."
    chunks = chunker.chunk(text, uuid4(), uuid4())
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_overlap_carries_content_into_next_chunk():
    chunker = RecursiveTextChunker(chunk_size=40, chunk_overlap=10)
    text = "A" * 40 + " " + "B" * 40 + " " + "C" * 40
    chunks = chunker.chunk(text, uuid4(), uuid4())
    assert len(chunks) >= 2
    # The tail of chunk N should reappear at the head of chunk N+1.
    assert chunks[0].content[-10:] in chunks[1].content


def test_empty_text_produces_no_chunks():
    chunker = RecursiveTextChunker()
    assert chunker.chunk("   \n\n  ", uuid4(), uuid4()) == []
