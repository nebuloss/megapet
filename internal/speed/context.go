package speed

import (
	"context"
	"net/netip"
)

func contextWithAddr(ctx context.Context, addr netip.Addr) context.Context {
	return context.WithValue(ctx, clientAddrKey{}, addr)
}

func addrFromContext(ctx context.Context) (netip.Addr, bool) {
	a, ok := ctx.Value(clientAddrKey{}).(netip.Addr)
	return a, ok
}
