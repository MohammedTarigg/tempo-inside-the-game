"""Sentences for the screen: the tools an agent may use, the backends that write, the Verifier, and the writing path."""

from .backends import FoundryBackend, LocalBackend
from .tools import FactTools, ScopeError
from .verify import verify
from .writer import Breaker, Writer

__all__ = ["Breaker", "FactTools", "FoundryBackend", "LocalBackend", "ScopeError", "Writer", "verify"]
