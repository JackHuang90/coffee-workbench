// Native integration harness only: no serial, network, GPIO, or physical hardware.
#include "roast/core.hpp"
#include "roast/protocol.hpp"
#include <charconv>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>

int main() {
    roast::VirtualPlant plant;
    roast::Controller controller(plant, 4242);
    uint32_t now = 1000;
    controller.tick(now, roast::kDemoBuild ? plant.step(now) : roast::Sensor{});
    roast::LineFramer framer;
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.size() > roast::kMaxLine) return 2;
        if (line.rfind("@tick ", 0) == 0) {
            uint32_t delta = 0;
            const auto parsed = std::from_chars(line.data() + 6, line.data() + line.size(), delta);
            if (parsed.ec != std::errc{} || parsed.ptr != line.data() + line.size() || delta > 60000) return 3;
            while (delta) {
                const uint32_t step = delta > 100 ? 100 : delta;
                now += step;
                controller.tick(now, roast::kDemoBuild ? plant.step(now) : roast::Sensor{});
                delta -= step;
            }
            continue;
        }
        roast::LineFramer::Result result = roast::LineFramer::Result::None;
        for (char byte : line) result = framer.feed(byte, now);
        result = framer.feed('\n', now);
        if (result != roast::LineFramer::Result::Line) return 4;
        char response[roast::kResponseSize]{};
        const auto count = roast::respond(controller, framer.data(), framer.size(), now, response, sizeof response, roast::CommandSource::Usb);
        if (!count || count >= sizeof response) return 5;
        std::cout.write(response, static_cast<std::streamsize>(count));
        if (response[count - 1] != '\n') std::cout << '\n';
        framer.reset();
    }
    return 0;
}
