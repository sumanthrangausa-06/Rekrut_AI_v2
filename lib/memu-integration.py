from memu.app.service import MemoryService
from memu.app.settings import DatabaseConfig, LLMConfig, BlobConfig
import asyncio
import os

# MemU integration for Rekrut AI cross-agent memory
# This module provides a simple interface for agents to store and retrieve memories

class RekrutAIMemory:
    def __init__(self, db_path="./memu-data"):
        self.service = MemoryService(
            database_config=DatabaseConfig(
                backend="sqlite",
                connection_string=f"sqlite:///{db_path}/memu.db"
            ),
            blob_config=BlobConfig(
                resources_dir=f"{db_path}/resources"
            ),
            llm_profiles={
                "default": LLMConfig(
                    client_backend="openai",
                    api_key=os.getenv("OPENAI_API_KEY", ""),
                    model="gpt-4o-mini"
                )
            }
        )
    
    async def store(self, content: str, category: str = "general", tags: list = None):
        """Store a memory for cross-agent retrieval"""
        result = await self.service.memorize(
            content=content,
            category=category,
            tags=tags or []
        )
        return result
    
    async def retrieve(self, query: str, limit: int = 5):
        """Retrieve relevant memories for a query"""
        results = await self.service.retrieve(
            query=query,
            limit=limit
        )
        return results

# Singleton instance
_memory = None

def get_memory():
    global _memory
    if _memory is None:
        _memory = RekrutAIMemory()
    return _memory

if __name__ == "__main__":
    # Test the integration
    async def test():
        mem = get_memory()
        await mem.store("Candidate Search feature completed - bulk status, filters, CSV export", 
                       category="features", tags=["candidate-search", "completed"])
        results = await mem.retrieve("What features are completed?")
        print(results)
    
    asyncio.run(test())
