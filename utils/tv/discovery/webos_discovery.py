import logging
import asyncio
from typing import Optional
from typing import Dict

from ..base.tv_discovery import TVDiscoveryBase, TVDiscoveryFactory

logger = logging.getLogger(__name__)

class WebOSDiscovery(TVDiscoveryBase):
    """Discovery implementation for LG WebOS TVs"""

    def get_mac_prefixes(self) -> Dict[str, str]:
        return {
            # LG Electronics Main
            '00:E0:70': 'LG Electronics',
            '00:1C:62': 'LG Electronics',
            '00:1E:75': 'LG Electronics',
            '00:1F:6B': 'LG Electronics',
            '00:1F:E3': 'LG Electronics',
            '00:22:A9': 'LG Electronics',
            '00:24:83': 'LG Electronics',
            '00:25:E5': 'LG Electronics',
            '00:26:E2': 'LG Electronics',
            '00:34:DA': 'LG Electronics',
            '00:3A:AF': 'LG Electronics',
            '00:50:BA': 'LG Electronics',
            '00:52:A1': 'LG Electronics',
            '00:AA:70': 'LG Electronics',

            # LG TV/Display Specific
            '00:5A:13': 'LG WebOS TV',
            '00:C0:38': 'LG TV',
            '04:4E:5A': 'LG WebOS TV',
            '08:D4:6A': 'LG TV',
            '10:68:3F': 'LG Electronics TV',
            '10:F1:F2': 'LG TV',
            '10:F9:6F': 'LG Electronics TV',
            '2C:54:CF': 'LG Electronics TV',
            '2C:59:8A': 'LG Electronics TV',
            '34:4D:F7': 'LG Electronics TV',
            '38:8C:50': 'LG Electronics TV',
            '3C:BD:D8': 'LG Electronics TV',
            '40:B0:FA': 'LG Electronics TV',
            '48:59:29': 'LG Electronics TV',
            '50:55:27': 'LG Electronics TV',
            '58:A2:B5': 'LG Electronics TV',
            '60:E3:AC': 'LG Electronics TV',
            '64:99:5D': 'LG Electronics TV',
            '6C:DD:BC': 'LG Electronics TV',
            '70:91:8F': 'LG Electronics TV',
            '74:A5:28': 'LG Electronics TV',
            '78:5D:C8': 'LG Electronics TV',
            '7C:1C:4E': 'LG Electronics TV',
            '7C:AB:25': 'LG WebOS TV',
            '88:36:6C': 'LG Electronics TV',
            '8C:3C:4A': 'LG Electronics TV',
            '98:93:CC': 'LG Electronics TV',
            '98:D6:F7': 'LG Electronics TV',
            'A0:39:F7': 'LG Electronics TV',
            'A8:16:B2': 'LG Electronics TV',
            'A8:23:FE': 'LG Electronics TV',
            'AC:0D:1B': 'LG Electronics TV',
            'B4:0E:DC': 'LG Smart TV',
            'B4:E6:2A': 'LG Electronics TV',
            'B8:1D:AA': 'LG Electronics TV',
            'B8:AD:3E': 'LG Electronics TV',
            'BC:8C:CD': 'LG Smart TV',
            'BC:F5:AC': 'LG Electronics TV',
            'C4:36:6C': 'LG Electronics TV',
            'C4:9A:02': 'LG Smart TV',
            'C8:02:8F': 'LG Electronics TV',
            'C8:08:E9': 'LG Electronics TV',
            'CC:2D:8C': 'LG Electronics TV',
            'CC:FA:00': 'LG Electronics TV',
            'D0:13:FD': 'LG Electronics TV',
            'D8:4D:2C': 'LG Electronics TV',
            'DC:0B:34': 'LG Electronics TV',
            'E8:5B:5B': 'LG Electronics TV',
            'E8:F2:E2': 'LG Electronics TV',
            'F0:1C:13': 'LG Electronics TV',
            'F8:0C:F3': 'LG Electronics TV',
            'FC:4D:8C': 'LG WebOS TV',
        }

    def get_name(self) -> str:
        return "LG WebOS"

    def _is_tv_device(self, desc: str) -> bool:
        return 'LG Electronics' in desc or 'WebOS' in desc

    async def test_connection(self, ip: str) -> bool:
        """Test if TV is reachable using multiple methods"""
        logger.info(f"Testing connection to TV at {ip}")

        try:
            # Try netcat first
            result = await self._test_connection_nc(ip)
            if result:
                return True

            # Then try socket connections
            webos_ports = [3000, 3001, 8080, 8001, 8002]
            for port in webos_ports:
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    sock.settimeout(1)
                    result = sock.connect_ex((ip, int(port)))
                    sock.close()

                    if result == 0:
                        logger.info(f"Successfully connected to port {port}")
                        return True
                except Exception as e:
                    logger.debug(f"Socket connection to port {port} failed: {str(e)}")
                    continue

            # Try hostname resolution as last resort
            try:
                socket.gethostbyaddr(ip)
                logger.info(f"IP {ip} is resolvable, considering TV reachable")
                return True
            except socket.herror:
                pass

            logger.info(f"TV at {ip} is not reachable")
            return False

        except Exception as e:
            logger.error(f"Error testing TV connection: {str(e)}")
            return False

    def get_warning_message(self) -> Optional[str]:
        return None  # WebOS implementation is working, no warning needed

    async def _test_connection_nc(self, ip: str) -> bool:
        """Test TV connection using netcat"""
        logger.info(f"Testing connection to {ip} using netcat")
        try:
            # Test using netcat for common WebOS ports
            ports = ['3000', '3001', '8080', '8001', '8002']
            for port in ports:
                process = await asyncio.create_subprocess_exec(
                    'nc', '-zv', '-w1', ip, port,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await process.communicate()
                
                if process.returncode == 0:
                    logger.info(f"Netcat successfully connected to {ip}:{port}")
                    return True

            logger.info(f"No open ports found on {ip}")
            return False
        except Exception as e:
            logger.info(f"Netcat test failed: {str(e)}")
            return False

# Register the discoverer
TVDiscoveryFactory.register('webos', WebOSDiscovery())
